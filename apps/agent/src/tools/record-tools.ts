import { Type } from "typebox";
import type { AgentHarnessTool, ExecutionToolContext, Context } from "@earendil-works/pi-agent-core";
import type { FantoRecord, FantoServerClient } from "../clients/fanto-server-client.js";
import { requireRunMetadata } from "../harness/run-context.js";

type RecordClient = Pick<FantoServerClient, "getRecord" | "listRecords" | "searchRecords">;

const recordGetSchema = Type.Object({
  recordId: Type.String({ minLength: 1, description: "Record ID returned by record_list or record_search." }),
}, { additionalProperties: false });

const recordListSchema = Type.Object({
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, description: "Number of recent records to return. Defaults to 10." })),
  cursor: Type.Optional(Type.String({ minLength: 1, description: "Opaque nextCursor returned by a previous record_list call." })),
}, { additionalProperties: false });

const recordSearchSchema = Type.Object({
  query: Type.String({ minLength: 1, description: "Semantic query describing the past topic, thought, experience, person, or event to find." }),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, description: "Maximum matches to return. Defaults to 10." })),
}, { additionalProperties: false });

type RecordGetDetails = {
  recordId: string;
  eventAt: string;
  source: string;
  status: FantoRecord["status"];
  content: FantoRecord["content"];
};

type RecordListDetails = {
  data: Array<{
    recordId: string;
    eventAt: string;
    source: string;
    status: FantoRecord["status"];
    preview: string;
  }>;
  hasMore: boolean;
  nextCursor: string | null;
};

type RecordSearchDetails = {
  data: Array<{ recordId: string; snippet: string }>;
};

function requestContext(context: Context) {
  const metadata = requireRunMetadata(context);
  return {
    userId: metadata.userId,
    traceId: metadata.traceId,
    signal: context.abortSignal,
  };
}

function asToolResult<T>(details: T) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(details) }],
    details,
  };
}

export function buildRecordPreview(record: FantoRecord, maxLength = 500): string {
  const parts = [
    record.content.text.trim(),
    ...record.content.blocks.flatMap(block => {
      if (block.type === "image" && block.description?.trim()) return [`图片描述：${block.description.trim()}`];
      if (block.type === "audio" && block.transcription?.trim()) return [`音频转写：${block.transcription.trim()}`];
      return [];
    }),
  ].filter(Boolean);
  const preview = parts.join("\n");
  if (preview.length <= maxLength) return preview;
  if (maxLength <= 1) return preview.slice(0, maxLength);
  return `${preview.slice(0, maxLength - 1)}…`;
}

export function createRecordGetTool(client: RecordClient): AgentHarnessTool<ExecutionToolContext, typeof recordGetSchema, RecordGetDetails> {
  return {
    name: "record_get",
    label: "Read Record",
    description: "Read one complete Fanto Record when you already know its record ID. Use an ID returned by record_list or record_search. Do not use this tool to discover past records.",
    parameters: recordGetSchema,
    executionMode: "parallel",
    replay: "safe",
    async execute(_toolCallId, params, _onUpdate, _toolContext, _invocation, context) {
      const record = await client.getRecord(requestContext(context), params.recordId);
      return asToolResult({
        recordId: record.id,
        eventAt: record.eventAt,
        source: record.source,
        status: record.status,
        content: record.content,
      });
    },
  };
}

export function createRecordListTool(client: RecordClient): AgentHarnessTool<ExecutionToolContext, typeof recordListSchema, RecordListDetails> {
  return {
    name: "record_list",
    label: "List Recent Records",
    description: "List the user's recent Fanto Records in chronological timeline order. Use this for questions like 'what did I record recently?'. For finding records about a topic or past idea, use record_search instead.",
    parameters: recordListSchema,
    executionMode: "parallel",
    replay: "safe",
    async execute(_toolCallId, params, _onUpdate, _toolContext, _invocation, context) {
      const result = await client.listRecords(requestContext(context), {
        limit: params.limit ?? 10,
        cursor: params.cursor,
      });
      return asToolResult({
        data: result.data.map(record => ({
          recordId: record.id,
          eventAt: record.eventAt,
          source: record.source,
          status: record.status,
          preview: buildRecordPreview(record),
        })),
        hasMore: result.hasMore,
        nextCursor: result.nextCursor,
      });
    },
  };
}

export function createRecordSearchTool(client: RecordClient): AgentHarnessTool<ExecutionToolContext, typeof recordSearchSchema, RecordSearchDetails> {
  return {
    name: "record_search",
    label: "Search Past Records",
    description: "Semantically search the user's past Fanto Records for a topic, thought, experience, person, event, or previous opinion. Use record_list instead for simply browsing the most recent records.",
    parameters: recordSearchSchema,
    executionMode: "parallel",
    replay: "safe",
    async execute(_toolCallId, params, _onUpdate, _toolContext, _invocation, context) {
      const query = params.query.trim();
      if (!query) throw new Error("record_search query must not be empty");
      const result = await client.searchRecords(requestContext(context), {
        query,
        limit: params.limit ?? 10,
      });
      return asToolResult({ data: result.data });
    },
  };
}

export function createRecordTools(client: RecordClient): AgentHarnessTool<ExecutionToolContext>[] {
  return [
    createRecordGetTool(client),
    createRecordListTool(client),
    createRecordSearchTool(client),
  ];
}
