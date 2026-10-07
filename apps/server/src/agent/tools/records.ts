import { Type } from "typebox";
import type { Context } from "@earendil-works/pi-agent-core";
import type { AgentBusinessServices, AgentRecord } from "../business-services.js";
import { createRunContext } from "../context/index.js";
import { formatEventTime } from "../context/providers/current-time.js";
import type { FantoTool } from "./types.js";

type RecordClient = Pick<AgentBusinessServices, "readRecords">;

const recordReadSchema = Type.Object({
  recordIds: Type.Optional(Type.Array(
    Type.String({ minLength: 1, description: "当前上下文、任务引用或此前真实返回的 Record ID。" }),
    { minItems: 1, maxItems: 5, description: "已知且需要完整读取的 Record ID，最多 5 个。" },
  )),
  query: Type.Optional(Type.String({ minLength: 1, maxLength: 1000, description: "用于回想过去主题、经历、人物、事件或想法的一句自然线索。" })),
}, { additionalProperties: false });

type RecordGetDetails = {
  recordId: string;
  eventAt: string;
  source: string;
  status: AgentRecord["status"];
  content: AgentRecord["content"];
};

type RecordReadDetails = { records: RecordGetDetails[] };

function requestContext(context: Context) {
  const metadata = createRunContext.read(context);
  return {
    userId: metadata.userId,
    sessionId: metadata.sessionId,
    creative: metadata.creative,
    traceId: metadata.traceId,
    signal: context.abortSignal,
  };
}

function displayEventTime(eventAt: string, context: Context): string {
  return formatEventTime(eventAt, createRunContext.read(context).timeZone);
}

function asToolResult<T>(details: T) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(details) }],
    details,
  };
}

function readInput(params: { recordIds?: string[]; query?: string }): { recordIds?: string[]; query?: string } {
  const query = params.query?.trim();
  const recordIds = params.recordIds?.map(recordId => recordId.trim());
  if (recordIds?.some(recordId => !recordId)) throw new Error("record_read recordIds must not contain empty values");
  if (Boolean(recordIds) === Boolean(query)) throw new Error("record_read requires exactly one of recordIds or query");
  return recordIds ? { recordIds: [...new Set(recordIds)] } : { query };
}

export function createRecordReadTool(client: RecordClient): FantoTool<typeof recordReadSchema, RecordReadDetails> {
  return {
    name: "record_read",
    label: "读取用户记录",
    presentation: {
      visible: true,
      start: { displayContent: "🤔 正在回忆...", animation: "thinking" },
      succeeded: { displayContent: "💡 想起来了" },
      failed: { displayContent: "这次没能回想起来" },
    },
    description: "读取与当前问题相关的用户 Record。\n\n已知需要读取的真实 Record ID 时，传 recordIds；它必须来自当前上下文、任务引用或此前真实返回的信息。\n需要回想某个主题、经历、人物、事件或想法时，传 query；系统会先找最相关的 Record，再返回完整内容。\n\nrecordIds 与 query 必须且只能提供一个。不要传 limit。\nquery 结果最多返回 3 条完整 Record；recordIds 最多读取 5 条。\n近期 Record 已在上下文中提供。不要为了浏览或重复读取近期内容调用此工具。",
    parameters: recordReadSchema,
    executionMode: "parallel",
    replay: "safe",
    async execute(_toolCallId, params, _onUpdate, _toolContext, _invocation, context) {
      const records = await client.readRecords(requestContext(context), readInput(params));
      return asToolResult({ records: records.map(record => ({
        recordId: record.id,
        eventAt: displayEventTime(record.eventAt, context),
        source: record.source,
        status: record.status,
        content: record.content,
      })) });
    },
  };
}
