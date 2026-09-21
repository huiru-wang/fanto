import { Type } from "typebox";
import type { AgentHarnessTool, ExecutionToolContext, Context } from "@earendil-works/pi-agent-core";
import type { FantoRecord, FantoServerClient } from "../fanto/client.js";
import { requireRunMetadata } from "../agent/run-context.js";
import { formatEventTime } from "../context/providers/time.js";

type RecordClient = Pick<FantoServerClient, "getRecord" | "listRecords" | "searchRecords">;

const recordGetSchema = Type.Object({
  recordId: Type.String({ minLength: 1, description: "已知记录的标识。只能使用其他记录能力实际返回的标识。" }),
}, { additionalProperties: false });

const recordListSchema = Type.Object({
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, description: "这次想回顾多少条最近记录；默认 10 条。" })),
  cursor: Type.Optional(Type.String({ minLength: 1, description: "继续查看上一批记录中更早的内容时，使用上次返回的 nextCursor。" })),
}, { additionalProperties: false });

const recordSearchSchema = Type.Object({
  query: Type.String({ minLength: 1, description: "帮助回想过去主题、经历、人物、事件或想法的一句自然线索。" }),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, description: "最多带回多少条相关线索；默认 10 条。" })),
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
  data: Array<{
    recordId: string;
    sourceType: "record_text" | "image" | "audio";
    mediaId: string | null;
    snippet: string;
    distance: number;
    eventAt: string;
  }>;
};

function requestContext(context: Context) {
  const metadata = requireRunMetadata(context);
  return {
    userId: metadata.userId,
    traceId: metadata.traceId,
    signal: context.abortSignal,
  };
}

function displayEventTime(eventAt: string, context: Context): string {
  return formatEventTime(eventAt, requireRunMetadata(context).timeZone);
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
    label: "补全一段记忆",
    description: "当已经知道某一条记录，并且需要其中更完整的文字、图片描述或音频转写来可靠回答时使用。不要用它盲目寻找过去的事。",
    parameters: recordGetSchema,
    executionMode: "parallel",
    replay: "safe",
    async execute(_toolCallId, params, _onUpdate, _toolContext, _invocation, context) {
      const record = await client.getRecord(requestContext(context), params.recordId);
      return asToolResult({
        recordId: record.id,
        eventAt: displayEventTime(record.eventAt, context),
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
    label: "按时间回顾记录",
    description: "当需要回顾用户最近记录过什么、或按时间梳理一段近况时使用。若要回想某个具体主题、经历或想法，使用 record_search。",
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
          eventAt: displayEventTime(record.eventAt, context),
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
    label: "回想相关记录",
    description: "当当前对话需要回想用户过去有关某个主题、经历、人物、事件或想法的内容时使用。若只是按时间浏览最近记录，使用 record_list。",
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
      return asToolResult({ data: result.data.map(record => ({ ...record, eventAt: displayEventTime(record.eventAt, context) })) });
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
