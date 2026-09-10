import { AgentHarness, type HarnessTool } from "@earendil-works/pi-agent-core";
import type { Model, Models } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import type { AgentHarnessTool } from "@earendil-works/pi-agent-core";
import type { Session } from "@earendil-works/pi-agent-core";
import type { Record, Result, Thread } from "./schemas.js";
import { SpecialistRunner } from "./specialist-runner.js";
import { validateResult, validateThread } from "./quality-gate.js";

export type ExperimentState = { records: Record[]; threads: Thread[]; actions: Result[]; batch: number; delegations: string[]; memorySearches: number; batchDelegations: number };
type Context = { state: ExperimentState; runner: SpecialistRunner; runDir: string };
const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }], details: undefined });

function tool(name: string, description: string, parameters: ReturnType<typeof Type.Object>, execute: (args: any, context: Context) => Promise<unknown>): AgentHarnessTool<Context, ReturnType<typeof Type.Object>> {
  return { name, label: name, description, parameters, execute: async (_id, args, _signal, _update, context) => json(await execute(args, context)) } as AgentHarnessTool<Context, ReturnType<typeof Type.Object>>;
}

export function mainTools(): HarnessTool[] {
  const source = Type.Object({ recordIds: Type.Array(Type.String(), { minItems: 1, maxItems: 20 }) });
  const delegation = Type.Object({ brief: Type.String({ minLength: 1, maxLength: 4000 }), sourceRecordIds: Type.Array(Type.String(), { minItems: 1, maxItems: 20 }) });
  const tools = [
    tool("get_records", "Get complete fixture records by id.", source, async (args, { state }) => state.records.filter(record => args.recordIds.includes(record.id))),
    tool("search_records", "Search fixture records by text.", Type.Object({ query: Type.String({ minLength: 1 }), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })) }), async (args, { state }) => {
      if (++state.memorySearches > 3) return { error: "memory search budget exhausted" };
      return state.records.filter(record => record.text.includes(args.query)).slice(0, args.limit ?? 5);
    }),
    tool("get_threads", "Get active experimental Threads.", Type.Object({}), async (_args, { state }) => state.threads),
    tool("get_recent_actions", "Get previously presented experimental results.", Type.Object({}), async (_args, { state }) => state.actions.slice(-10)),
    tool("save_thread", "Create or update a growing Thread.", Type.Object({ thread: Type.Object({ id: Type.String(), title: Type.String(), thesis: Type.String(), evidence: Type.Array(Type.String(), { minItems: 2 }), openEdges: Type.Array(Type.String()), status: Type.Union([Type.Literal("candidate"), Type.Literal("active"), Type.Literal("dormant")]) }) }), async (args, { state }) => {
      const issue = validateThread(args.thread, new Set(state.records.filter(record => record.batch === state.batch).map(record => record.id)), new Set(state.records.map(record => record.id)));
      if (issue) return { saved: false, issue };
      state.threads = [...state.threads.filter(thread => thread.id !== args.thread.id), args.thread]; return { saved: true };
    }),
    tool("save_result", "Present a Moment or Possibility after checking it.", Type.Object({ result: Type.Object({ kind: Type.Union([Type.Literal("moment"), Type.Literal("possibility")]), content: Type.String({ minLength: 1 }), sourceRecordIds: Type.Array(Type.String(), { minItems: 1 }), artifactPaths: Type.Array(Type.String()) }) }), async (args, { state, runDir }) => {
      const issue = validateResult(args.result, state.records, runDir); if (issue) return { saved: false, issue };
      state.actions.push(args.result); return { saved: true };
    }),
    tool("dismiss", "Record that nothing should be shown to the user.", Type.Object({ reason: Type.String({ minLength: 1 }) }), async args => ({ dismissed: true, reason: args.reason })),
    ...(["research", "code", "image"] as const).map(kind => tool(`delegate_${kind}`, `Delegate specialized ${kind} work to an isolated Pi child agent.`, delegation, async (args, { state, runner }) => {
      if (++state.batchDelegations > 1) return { error: "delegation budget exhausted" };
      const delegated = await runner.run({ kind, brief: args.brief, sourceRecordIds: args.sourceRecordIds }, state.records.filter(record => args.sourceRecordIds.includes(record.id)));
      state.delegations.push(delegated.id); return { delegationId: delegated.id, ...delegated.result };
    })),
  ];
  return tools as unknown as HarnessTool[];
}

export async function createMainAgent(session: Session, models: Models, model: Model<any>, context: Context) {
  const { harness } = await AgentHarness.create({
    session, models, model, thinkingLevel: "low", tools: mainTools(), activeToolNames: mainTools().map(tool => tool.name), toolContext: context, toolExecution: "sequential",
    systemPrompt: "You are Fanto, an orchestrator. Inspect changes, then either update a Thread, delegate one specialist for a Moment/Possibility, or dismiss. Do not write code, research reports, or image prompts yourself. You must use save_thread, save_result, or dismiss before ending each wake-up.",
  });
  return harness;
}
