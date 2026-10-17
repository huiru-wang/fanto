import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TODO_CONTEXT } from "@earendil-works/pi-agent-core";
import { createModels } from "@earendil-works/pi-ai";
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { AgentSessionManager, SessionOwnershipError } from "../harness/session-manager.js";
import { runAgent, requestAgentStop } from "../harness/run.js";
import { createAgentRoutes } from "../../routes/agent/stream.js";
import { createSessionRoutes } from "../../routes/agent/sessions.js";
import { runWithRequestPrincipal } from "../../routes/request-user.js";
import { SkillLoader } from "../skills/loader.js";
import type { AgentDefinition } from "../harness/definition.js";
import type { AgentRequestContext, AgentBusinessServices } from "../business-services.js";
import { SnapshotWriter, type SnapshotStore, type SessionSnapshot } from "./session-snapshots.js";

const definition = (provider: string, model: string, tools: AgentDefinition["tools"] = []): AgentDefinition => ({
  id: "main", description: "test", modelId: `${provider}/${model}`, provider, model, systemPrompt: "test", tools,
  skills: [], compaction: { enabled: false, reserveTokens: 1024, keepRecentTokens: 1024 }, revision: "v1",
});
const principal = { userId: "owner", source: "user" } as const;
const deadline = async <T>(promise: Promise<T>, ms = 2000): Promise<T> => {
  let timer: ReturnType<typeof setTimeout>;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error("deadline")), ms); })]); }
  finally { clearTimeout(timer!); }
};
const output = (sse: string): string => sse.split("\n").filter(line => line.startsWith("data: ")).map(line => JSON.parse(line.slice(6))).map(data => data.text ?? "").join("");
function fixture(store: SnapshotStore, fanto = {} as AgentBusinessServices, tools: AgentDefinition["tools"] = []) {
  const workspace = mkdtempSync(join(tmpdir(), "fanto-live-"));
  const faux = fauxProvider({ tokensPerSecond: 100000, tokenSize: { min: 1, max: 1 } });
  const models = createModels(); models.setProvider(faux.provider);
  const model = faux.getModel();
  const def = definition(model.provider, model.id, tools);
  const manager = new AgentSessionManager(models, fanto, new SkillLoader(join(workspace, "skills")), undefined as never, workspace, store);
  const registry = { get: (id: string) => id === "main" ? def : undefined };
  const streams = createAgentRoutes(registry as never, manager);
  const sessions = createSessionRoutes(registry as never, manager);
  const chat = (sessionId: string, message: string) => runWithRequestPrincipal(principal, () => streams.request("/stream", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, message }),
  }));
  const history = (id: string) => runWithRequestPrincipal(principal, () => sessions.request(`/sessions/${id}/history`));
  const stop = (id: string) => runWithRequestPrincipal(principal, () => sessions.request(`/sessions/${id}/stop`, { method: "POST" }));
  return { faux, manager, def, chat, history, stop, async close() { await manager.close(); rmSync(workspace, { recursive: true, force: true }); } };
}

// The database deliberately cannot resolve until both complete turns have already finished.
test("real HTTP + SDK: blocked snapshot writes do not delay done, live history, or the next turn", async t => {
  let unblock!: () => void;
  const held = new Promise<void>(resolve => { unblock = resolve; });
  const saved: SessionSnapshot[] = [];
  const f = fixture({ read: async () => undefined, write: async snapshot => { await held; saved.push(snapshot); } });
  try {
    const session = await f.manager.create(f.def, "owner");
    let lastDelta = 0;
    session.harness.events.on("message_update", ({event}) => { if (event.type === "text_delta") lastDelta = performance.now(); });
    f.faux.setResponses([fauxAssistantMessage("a".repeat(1000)), fauxAssistantMessage("continued")]);
    const first = await deadline((await f.chat(session.id, "first")).text());
    assert.match(first, /event: done/);
    const tailMs = performance.now() - lastDelta;
    t.diagnostic(`blocked database: last delta to done ${tailMs.toFixed(1)} ms`);
    assert.ok(tailMs < 300, `unexpected tail: ${tailMs}`);
    assert.equal(saved.length, 0);
    const history = await (await f.history(session.id)).json() as any;
    assert.equal(history.result.running, false);
    assert.equal(history.result.messages.at(-1).blocks[0].content, "a".repeat(1000));
    let previousReplyInContext = false;
    session.harness.hooks.on("transform_context", event => {
      previousReplyInContext ||= event.messages.some(message => message.role === "assistant" && JSON.stringify(message.content).includes("a".repeat(1000)));
      return undefined;
    });
    assert.equal(output(await deadline((await f.chat(session.id, "next")).text())), "continued");
    assert.equal(previousReplyInContext, true);
    assert.equal(saved.length, 0);
    await assert.rejects(f.manager.assertOwnership(session.id, "foreign"), SessionOwnershipError);
    unblock();
  } finally { unblock(); await f.close(); }
});

test("snapshot writer is bounded and coalesces pending versions even after an error", async () => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const revisions: number[] = [];
  const writer = new SnapshotWriter({ read: async () => undefined, write: async snapshot => {
    revisions.push(snapshot.revision);
    if (snapshot.revision === 1) { await held; throw Error("offline"); }
  } });
  const base = { format: 1, metadata: { id: "id", createdAt: 1, storageVersion: 1 }, entries: [], tip: null, userId: "owner", agentId: "main" } as const;
  for (let revision = 1; revision <= 100; revision++) writer.enqueue({ ...base, entries: [], revision });
  release(); await writer.flush();
  assert.deepEqual(revisions, [1, 100]);
  assert.equal(writer.isSaved("id", 100), true);
});

test("stopped text survives page refresh from memory and process recreation from the last snapshot", async () => {
  const snapshots = new Map<string, SessionSnapshot>();
  const store = { read: async (id: string) => snapshots.get(id), write: async (snapshot: SessionSnapshot) => { snapshots.set(snapshot.metadata.id, snapshot); } };
  const f = fixture(store);
  let id = "";
  let partial = "";
  try {
    const session = await f.manager.create(f.def, "owner"); id = session.id;
    f.faux.setResponses([fauxAssistantMessage("a".repeat(10000))]);
    const release = f.manager.reserve(session);
    const run = runAgent(session, "first", new AbortController().signal, {}, async event => {
      if (event.type === "delta") { partial += event.text; requestAgentStop(id); }
    });
    await assert.rejects(run, { name: "AbortError" });
    await f.manager.checkpoint(id); release();
    const current = (await (await f.history(id)).json() as any).result.messages.at(-1);
    assert.equal(current.state, "stopped"); assert.ok(current.blocks[0].content.startsWith(partial));
  } finally { await f.close(); }
  const restored = fixture(store);
  try {
    const result = (await (await restored.history(id)).json() as any).result;
    assert.equal(result.restored, true);
    assert.equal(result.messages.at(-1).state, "stopped");
    assert.ok(result.messages.at(-1).blocks[0].content.startsWith(partial));
    restored.faux.setResponses([fauxAssistantMessage("after restart")]);
    assert.equal(output(await deadline((await restored.chat(id, "continue")).text())), "after restart");
  } finally { await restored.close(); }
});

test("stop during a real tool returns 202, preserves its signal/result, and prevents further work", async () => {
  let started!: () => void, finish!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const held = new Promise<void>(resolve => { finish = resolve; });
  let calls = 0, aborted = false;
  const f = fixture({ read: async () => undefined, write: async () => {} }, {
    readRecords: async (context: AgentRequestContext) => { calls++; started(); await held; aborted = context.signal?.aborted ?? false; return []; },
  } as unknown as AgentBusinessServices, ["record_read"]);
  try {
    const session = await f.manager.create(f.def, "owner");
    f.faux.setResponses([fauxAssistantMessage(fauxToolCall("record_read", { recordIds: ["record"] })), fauxAssistantMessage("this must be the next user turn")]);
    const response = await f.chat(session.id, "find records");
    const text = response.text();
    await deadline(entered);
    const stopped = await deadline(Promise.resolve(f.stop(session.id)));
    assert.equal(stopped.status, 202);
    assert.equal((await stopped.json() as any).result.stopping, true);
    const pending = (await (await f.history(session.id)).json() as any).result;
    assert.equal(pending.running, true); assert.equal(pending.stopping, true);
    assert.equal((await f.chat(session.id, "too soon")).status, 409);
    finish();
    assert.match(await deadline(text), /event: stopped/);
    assert.equal(aborted, false); assert.equal(calls, 1);
    const entries = await session.session.findEntries({ type: "message" }, TODO_CONTEXT);
    assert.ok(entries.some(entry => entry.type === "message" && entry.message.role === "toolResult" && !entry.message.isError));
    assert.equal(output(await deadline((await f.chat(session.id, "continue")).text())), "this must be the next user turn");
    assert.equal(calls, 1);
  } finally { finish(); await f.close(); }
});


test("disconnect is not stop: live history recovers partial output and the turn completes", async () => {
  const f = fixture({read: async()=>undefined, write: async()=>{throw Error("offline");}});
  try {
    const session = await f.manager.create(f.def, "owner");
    f.faux.setResponses([fauxAssistantMessage("a".repeat(1200))]);
    const response = await f.chat(session.id, "first");
    const reader = response.body!.getReader();
    let text = "";
    while (!text.includes("event: delta")) {
      const chunk = await deadline(reader.read());
      assert.equal(chunk.done, false);
      text += new TextDecoder().decode(chunk.value);
    }
    const partial = (await (await f.history(session.id)).json() as any).result;
    assert.equal(partial.running, true);
    assert.ok(partial.messages.at(-1).blocks[0].content.length > 0);
    await reader.cancel();
    await deadline(f.manager.waitUntilIdle(session.id));
    const done = (await (await f.history(session.id)).json() as any).result;
    assert.equal(done.running, false);
    assert.equal(done.messages.at(-1).blocks[0].content, "a".repeat(1200));
    assert.equal(done.messages.at(-1).state, undefined);
  } finally { await f.close(); }
});

test("stop while tool-call arguments stream prevents executing the tool", async () => {
  let calls = 0;
  const f = fixture({read:async()=>undefined,write:async()=>{}}, {
    readRecords:async()=>{calls++;return [];},
  } as unknown as AgentBusinessServices,["record_read"]);
  try {
    const session=await f.manager.create(f.def,"owner");
    f.faux.setResponses([fauxAssistantMessage(fauxToolCall("record_read",{recordIds:["record"]}))]);
    session.harness.events.on("message_update",({event})=>{
      if(event.type==="toolcall_delta")requestAgentStop(session.id);
    });
    assert.match(await deadline((await f.chat(session.id,"find records")).text()),/event: stopped/);
    assert.equal(calls,0);
    assert.equal((await (await f.history(session.id)).json() as any).result.messages.at(-1).state,"stopped");
  } finally {await f.close();}
});


test("concurrent cold history reads cannot close the handle used by a new turn", async () => {
  const snapshots = new Map<string, SessionSnapshot>();
  const store = {read:async(id:string)=>snapshots.get(id),write:async(snapshot:SessionSnapshot)=>{snapshots.set(snapshot.metadata.id,snapshot);}};
  const first=fixture(store);
  let id="";
  try {
    const session=await first.manager.create(first.def,"owner"); id=session.id;
    first.faux.setResponses([fauxAssistantMessage("saved")]);
    await (await first.chat(id,"first")).text();
  } finally {await first.close();}
  const next=fixture(store);
  try {
    next.faux.setResponses([fauxAssistantMessage("continued")]);
    const responses=await Promise.all([next.history(id),next.history(id),next.chat(id,"next")]);
    assert.ok(responses.every(response=>response.status===200));
    const body=await deadline(responses[2].text());
    assert.equal(output(body),"continued"); assert.match(body,/event: done/);
  } finally {await next.close();}
});
