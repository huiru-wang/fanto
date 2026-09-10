import { Type } from "typebox";
import type { AgentHarnessTool } from "@earendil-works/pi-agent-core";
import type { RecordMemoryService } from "../../application/memory/record-memory.js";

type MemoryToolContext = { userId: string; memory: RecordMemoryService };
const searchParameters = Type.Object({ query: Type.String({ minLength: 1, maxLength: 2_000 }), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })) });
const getParameters = Type.Object({ recordIds: Type.Array(Type.String({ format: "uuid" }), { minItems: 1, maxItems: 20 }) });

export function createSearchRecordsTool(): AgentHarnessTool<MemoryToolContext, typeof searchParameters> {
  return {
    name: "search_records",
    label: "search_records",
    description: "Search the current user's related record memories. Each result includes a recordId for retrieving the original record.",
    parameters: searchParameters,
    execute: async (_id, args, _signal, _onUpdate, context) => ({ content: [{ type: "text", text: JSON.stringify({ matches: await context.memory.search(context.userId, args.query, args.limit ?? 8) }) }], details: undefined }),
  } as AgentHarnessTool<MemoryToolContext, typeof searchParameters>;
}

export function createGetRecordsTool(): AgentHarnessTool<MemoryToolContext, typeof getParameters> {
  return {
    name: "get_records",
    label: "get_records",
    description: "Get complete original records for the current user by recordId. This does not search vector memory.",
    parameters: getParameters,
    execute: async (_id, args, _signal, _onUpdate, context) => ({ content: [{ type: "text", text: JSON.stringify({ records: await context.memory.getRecords(context.userId, args.recordIds) }) }], details: undefined }),
  } as AgentHarnessTool<MemoryToolContext, typeof getParameters>;
}
