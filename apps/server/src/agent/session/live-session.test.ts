import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TODO_CONTEXT } from "@earendil-works/pi-agent-core";
import { createModels } from "@earendil-works/pi-ai";
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { AgentSessionManager } from "../harness/session-manager.js";
import { requestAgentStop, runAgent } from "../harness/run.js";
import { createAgentRoutes } from "../../routes/agent/stream.js";
import { createSessionRoutes } from "../../routes/agent/sessions.js";
import { runWithRequestPrincipal } from "../../routes/request-user.js";
import { SkillLoader } from "../skills/loader.js";
import type { AgentDefinition } from "../harness/definition.js";
import type { AgentBusinessServices, AgentRequestContext } from "../business-services.js";
import type { CheckpointItem, CheckpointRepository, StoredSession } from "../checkpoint/postgres-repository.js";
import type { Entry, UsageRow } from "@earendil-works/pi-agent-core";

class MemoryCheckpoint {
  readonly sessions = new Map<string, StoredSession>();
  readonly entries = new Map<string, Array<Entry & { runId: string | null }>>();
  readonly usages = new Map<string, UsageRow[]>();
  commits = 0;
  fail = false;
  async createSession(id: string, userId: string, agentId: string) {
    this.sessions.set(id, { id, userId, agentId, createdAt: Date.now(), updatedAt: Date.now(), tipId: null, title: null });
  }
  async getSession(id: string, userId?: string) {
    const row = this.sessions.get(id);
    return row && (userId === undefined || row.userId === userId) ? row : undefined;
  }
  async persist(id: string, items: readonly CheckpointItem[]) {
    if (this.fail) throw new Error("database unavailable");
    if (!items.length) return;
    const session = this.sessions.get(id)!;
    const entries = this.entries.get(id) ?? [], usages = this.usages.get(id) ?? [];
    let seq = Math.max(0, ...entries.map(e => e.seq), ...usages.map(e => e.seq)) + 1;
    for (const item of items) {
      if (item.kind === "entry" && !entries.some(e => e.id === item.entry.id)) {
        entries.push({ ...item.entry, seq: seq++, runId: item.runId });
        session.tipId = item.entry.id;
      } else if (item.kind === "usage" && !usages.some(u => u.id === item.row.id)) {
        usages.push({ ...item.row, seq: seq++ });
      }
    }
    this.entries.set(id, entries); this.usages.set(id, usages);
    session.updatedAt = Date.now(); this.commits++;
  }
  async loadEntries(id: string) { return (this.entries.get(id) ?? []).map(({ runId: _id, ...entry }) => entry as Entry); }
  async loadUsage(id: string) { return this.usages.get(id) ?? []; }
  async history(id: string, cursor: number | undefined, limit: number) {
    const rows = this.entries.get(id) ?? [];
    const anchors = [...new Set(rows.filter(e => e.runId).map(e => e.runId!))]
      .map(runId => ({ runId, seq: Math.min(...rows.filter(e => e.runId === runId).map(e => e.seq)) }))
      .filter(row => cursor === undefined || row.seq < cursor).sort((a,b) => b.seq-a.seq);
    const hasMore = anchors.length > limit, chosen = anchors.slice(0, limit);
    const selected = new Set(chosen.map(a => a.runId));
    return { entries: rows.filter(row => row.runId && selected.has(row.runId)).map(({runId: _id, ...entry}) => entry as Entry),
      hasMore, nextCursor: hasMore ? chosen.at(-1)!.seq : null };
  }
  async list(userId: string, agentId: string) {
    return { data: [...this.sessions.values()].filter(s => s.userId === userId && s.agentId === agentId).map(s => ({
      sessionId: s.id, agentId: s.agentId, title: s.title,
      createdAt: new Date(s.createdAt).toISOString(), updatedAt: new Date(s.updatedAt).toISOString(),
    })), hasMore: false, nextCursor: null };
  }
}

const makeDefinition = (provider: string, model: string, tools: AgentDefinition["tools"] = []): AgentDefinition => ({
  id: "main", description: "test", modelId: `${provider}/${model}`, provider, model, systemPrompt: "test", tools,
  skills: [], compaction: { enabled: false, reserveTokens: 1024, keepRecentTokens: 1024 }, revision: "v1",
});
const principal = { userId: "owner", source: "user" } as const;
function fixture(checkpoints: MemoryCheckpoint, fanto = {} as AgentBusinessServices, tools: AgentDefinition["tools"] = []) {
  const workspace = mkdtempSync(join(tmpdir(), "fanto-v2-"));
  const faux = fauxProvider({ tokensPerSecond: 100000, tokenSize: { min: 1, max: 1 } });
  const models = createModels(); models.setProvider(faux.provider);
  const model = faux.getModel(), definition = makeDefinition(model.provider, model.id, tools);
  const manager = new AgentSessionManager(models, fanto, new SkillLoader(join(workspace, "skills")),
    undefined as never, workspace, checkpoints as unknown as CheckpointRepository);
  const registry = { get: (id: string) => id === "main" ? definition : undefined };
  const streams = createAgentRoutes(registry as never, manager), sessions = createSessionRoutes(registry as never, manager);
  const chat = (id: string, message: string) => runWithRequestPrincipal(principal, () => streams.request("/stream", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: id, message }),
  }));
  const history = (id: string, cursor?: number, limit = 20) => runWithRequestPrincipal(principal, () =>
    sessions.request(`/sessions/${id}/history?limit=${limit}${cursor === undefined ? "" : `&cursor=${cursor}`}`));
  const stop = (id: string) => runWithRequestPrincipal(principal, () =>
    sessions.request(`/sessions/${id}/stop`, {method:"POST"}));
  return { faux, manager, definition, chat, history, stop, async close() {
    await manager.close(); rmSync(workspace, {recursive:true,force:true});
  }};
}
const texts = (sse: string) => sse.split("\n").filter(line=>line.startsWith("data: "))
  .map(line=>{ try {return JSON.parse(line.slice(6)) as {text?:string};} catch {return {};} })
  .map(e=>e.text??"").join("");

test("Pi real loop: checkpoint every Turn, run pagination and database-backed restart", async () => {
  const db = new MemoryCheckpoint(), a = fixture(db);
  let id = "";
  try {
    const session = await a.manager.create(a.definition, "owner"); id = session.id;
    a.faux.setResponses([fauxAssistantMessage("answer one"), fauxAssistantMessage("answer two")]);
    assert.match(await (await a.chat(id,"first")).text(), /event: done/);
    assert.match(await (await a.chat(id,"second")).text(), /event: done/);
    assert.ok(db.commits >= 2);
    const latest = (await (await a.history(id, undefined, 1)).json() as any).result;
    assert.equal(latest.hasMore, true);
    assert.equal(latest.messages[0].blocks[0].content, "second");
    assert.equal(latest.messages.at(-1).blocks[0].content, "answer two");
    const earlier = (await (await a.history(id, latest.nextCursor, 1)).json() as any).result;
    assert.equal(earlier.messages[0].blocks[0].content, "first");
  } finally { await a.close(); }
  const b = fixture(db);
  try {
    assert.equal(await b.manager.resolveAgentId(id, "owner"), "main");
    b.faux.setResponses([fauxAssistantMessage("after restart")]);
    assert.equal(texts(await (await b.chat(id, "continue")).text()), "after restart");
    assert.equal(b.manager.restored(id), true);
  } finally { await b.close(); }
});

test("checkpoint failure produces error not done, and retains unsaved Entries", async () => {
  const db = new MemoryCheckpoint(), f = fixture(db);
  try {
    const session = await f.manager.create(f.definition, "owner");
    db.fail = true;
    f.faux.setResponses([fauxAssistantMessage("saved only in memory")]);
    const wire = await (await f.chat(session.id,"hello")).text();
    assert.match(wire, /event: error/);
    assert.doesNotMatch(wire, /event: done/);
    assert.equal(session.checkpoint.hasPending, true);
    db.fail = false;
    await f.manager.checkpoint(session.id);
    assert.ok(db.entries.get(session.id)?.some(e => e.type === "message" && e.message.role === "assistant"));
  } finally { await f.close(); }
});

test("Pi stop waits for active tool and saves its Tool Result before stopped", async () => {
  let started!: () => void, finish!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const held = new Promise<void>(resolve => { finish = resolve; });
  let calls = 0, aborted = false;
  const db = new MemoryCheckpoint();
  const f = fixture(db, {
    readRecords: async (ctx: AgentRequestContext) => { calls++; started(); await held; aborted = ctx.signal?.aborted ?? false; return []; },
  } as unknown as AgentBusinessServices, ["record_read"]);
  try {
    const session = await f.manager.create(f.definition, "owner");
    f.faux.setResponses([fauxAssistantMessage(fauxToolCall("record_read", {recordIds:["record"]})), fauxAssistantMessage("do not call")]);
    const response = await f.chat(session.id,"find records");
    const terminal = response.text();
    await entered;
    const stopped = await f.stop(session.id);
    assert.equal(stopped.status, 202);
    finish();
    assert.match(await terminal, /event: stopped/);
    assert.equal(aborted, false);
    assert.equal(calls, 1);
    assert.ok(db.entries.get(session.id)?.some(e => e.type === "message" && e.message.role === "toolResult"));
    assert.ok(db.entries.get(session.id)?.some(e => e.type === "custom" && e.customType === "fanto.run_stopped"));
  } finally { finish(); await f.close(); }
});

test("Pi SDK runs remain isolated by Session owner", async () => {
  const db = new MemoryCheckpoint(), f = fixture(db);
  try {
    const session = await f.manager.create(f.definition,"owner");
    await assert.rejects(f.manager.assertOwnership(session.id,"other"));
    const response = await runWithRequestPrincipal({userId:"other",source:"user"}, () =>
      createSessionRoutes({get:()=>f.definition} as never,f.manager).request(`/sessions/${session.id}/history`));
    assert.equal(response.status,403);
  } finally { await f.close(); }
});
