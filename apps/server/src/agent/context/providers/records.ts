import type { Context } from "@earendil-works/pi-agent-core";
import type { Models } from "@earendil-works/pi-ai";
import { formatLocationContext } from "@fanto/shared";
import { z } from "zod";
import type { AgentBusinessServices, AgentRecord, AgentRecordSearch } from "../../business-services.js";
import { createRunContext, type RunData } from "../run-context.js";
import { formatEventTime } from "./current-time.js";

type RecordClient = Pick<AgentBusinessServices, "listRecords" | "searchRecords">;
type SearchHit = AgentRecordSearch["data"][number];
export type RecordContextMode = "recent" | "relevant";
const rewriteResult = z.object({ queries: z.array(z.string().trim().min(1)).max(2) }).strict();
const RECENT_RECORD_LIMIT = 10;
const RECORD_TEXT_LIMIT = 300;
const MEDIA_TEXT_LIMIT = 160;

interface QueryRewriter { rewrite(input: RunData, signal?: AbortSignal): Promise<string[]>; }

export class PiQueryRewriter implements QueryRewriter {
  constructor(private readonly models: Models, private readonly provider = "deepseek", private readonly modelId = "deepseek-v4-flash") {}
  async rewrite(input: RunData, signal?: AbortSignal): Promise<string[]> {
    const model = this.models.getModel(this.provider, this.modelId);
    if (!model) throw new Error(`Context rewrite model is unavailable: ${this.provider}/${this.modelId}`);
    const history = input.recentMessages.slice(-8).map(item => `${item.role}: ${item.text}`).join("\n");
    const response = await this.models.completeSimple(model, { systemPrompt: `你是用户记录检索 Query Rewriter。判断当前消息是否需要历史记录帮助，并把对话中的指代改写成适合语义检索的查询。\n只输出严格 JSON：{"queries":["query1","query2"]}。\n最多 2 条。当前问题与历史无关、纯知识问答、简单寒暄时返回 {"queries":[]}。\n不要回答用户问题，不要虚构近期对话中没有出现的人物身份或事实。`, messages: [{ role: "user", content: `最近对话：\n${history || "（无）"}\n\n当前消息：\n${input.query}`, timestamp: Date.now() }] }, { signal });
    const text = response.content.flatMap(block => block.type === "text" ? [block.text] : []).join("").trim();
    return parseRewriteResult(text);
  }
}

export function parseRewriteResult(text: string): string[] {
  const cleaned = text.replace(/^\`\`\`(?:json)?\s*/i, "").replace(/\s*\`\`\`$/, "").trim();
  const parsed = rewriteResult.safeParse(JSON.parse(cleaned));
  if (!parsed.success) throw new Error("Invalid query rewrite response");
  return [...new Set(parsed.data.queries.map(query => query.trim()).filter(Boolean))].slice(0, 2);
}

function compact(value: string | undefined): string { return value?.trim().replace(/\s+/g, " ") ?? ""; }
export function truncateRecordText(value: string | undefined, maxLength: number): string { const text = compact(value); return !text ? "" : text.length <= maxLength ? text : `${text.slice(0, maxLength)}…`; }
export function formatRecentRecord(record: AgentRecord, timeZone: string | undefined): string {
  const lines = [`recordId: ${record.id}`, `时间: ${formatEventTime(record.eventAt, timeZone)}`, `内容: ${truncateRecordText(record.content.text, RECORD_TEXT_LIMIT) || "（无文字）"}`];
  if (record.content.blocks.length > 0) {
    lines.push("上下文:");
    for (const block of record.content.blocks) {
      if (block.type === "image") { const description = truncateRecordText(block.description, MEDIA_TEXT_LIMIT); lines.push(`- 图片: mediaId=${block.mediaId}${description ? `；描述=${description}` : ""}`); }
      else if (block.type === "audio") { const transcription = truncateRecordText(block.transcription, MEDIA_TEXT_LIMIT); lines.push(`- 音频: mediaId=${block.mediaId}${transcription ? `；转写=${transcription}` : ""}`); }
      else lines.push(`- ${formatLocationContext(block)}`);
    }
  }
  return lines.join("\n");
}

export class RecordContextProvider {
  readonly slot: "recent_records" | "relevant_records";
  constructor(private readonly client: RecordClient, private readonly mode: RecordContextMode, private readonly rewriter?: QueryRewriter) { this.slot = mode === "recent" ? "recent_records" : "relevant_records"; }
  async build(context: Context): Promise<{ slot: string; content: string }> { return this.mode === "recent" ? this.buildRecent(context) : this.buildRelevant(context); }
  private async buildRecent(context: Context): Promise<{ slot: string; content: string }> {
    const input = createRunContext.read(context);
    const result = await this.client.listRecords({ userId: input.userId, traceId: input.traceId, signal: context.abortSignal }, { limit: RECENT_RECORD_LIMIT });
    return { slot: this.slot, content: result.data.map(record => formatRecentRecord(record, input.timeZone)).join("\n\n") };
  }
  private async buildRelevant(context: Context): Promise<{ slot: string; content: string }> {
    if (!this.rewriter) throw new Error("Relevant record mode requires a query rewriter");
    const input = createRunContext.read(context);
    const queries = await this.rewriter.rewrite(input, context.abortSignal);
    if (queries.length === 0) return { slot: this.slot, content: "" };
    const searches = await Promise.all(queries.map(query => this.client.searchRecords({ userId: input.userId, traceId: input.traceId, signal: context.abortSignal }, { query, limit: 4 })));
    const records = dedupeRecords(searches.flatMap(result => result.data)).slice(0, 2);
    return { slot: this.slot, content: records.map((record, index) => `记录 ${index + 1}：\nrecordId：${record.recordId}\n- 记录：${record.snippet}\n- 时间：${formatEventTime(record.eventAt, input.timeZone)}${record.mediaId ? "\n- 可能有可展示媒体：是" : ""}`).join("\n\n") };
  }
}

export function createRecordContextProvider(options: { mode: "recent"; client: RecordClient } | { mode: "relevant"; client: RecordClient; models: Models }): RecordContextProvider {
  return options.mode === "recent" ? new RecordContextProvider(options.client, "recent") : new RecordContextProvider(options.client, "relevant", new PiQueryRewriter(options.models));
}
export function dedupeRecords(hits: SearchHit[]): SearchHit[] { const byRecord = new Map<string, SearchHit>(); for (const hit of hits) { const current = byRecord.get(hit.recordId); if (!current || hit.distance < current.distance) byRecord.set(hit.recordId, hit); } return [...byRecord.values()].sort((a, b) => a.distance - b.distance); }
