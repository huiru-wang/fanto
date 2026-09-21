import { z } from "zod";
import type { Models } from "@earendil-works/pi-ai";
import type { ContextInput } from "./types.js";

const rewriteResult = z.object({ queries: z.array(z.string().trim().min(1)).max(2) }).strict();

export interface QueryRewriter {
  rewrite(input: ContextInput): Promise<string[]>;
}

export class PiQueryRewriter implements QueryRewriter {
  constructor(
    private readonly models: Models,
    private readonly provider = "deepseek",
    private readonly modelId = "deepseek-v4-flash",
  ) {}

  async rewrite(input: ContextInput): Promise<string[]> {
    const model = this.models.getModel(this.provider, this.modelId);
    if (!model) throw new Error(`Context rewrite model is unavailable: ${this.provider}/${this.modelId}`);
    const history = input.recentMessages.slice(-8).map(item => `${item.role}: ${item.text}`).join("\n");
    const response = await this.models.completeSimple(model, {
      systemPrompt: `你是长期记忆检索 Query Rewriter。判断当前消息是否需要过去记忆帮助，并把对话中的指代改写成适合语义检索的查询。
只输出严格 JSON：{"queries":["query1","query2"]}。
最多 2 条。当前问题与历史无关、纯知识问答、简单寒暄时返回 {"queries":[]}。
不要回答用户问题，不要虚构近期对话中没有出现的人物身份或事实。`,
      messages: [{
        role: "user",
        content: `最近对话：\n${history || "（无）"}\n\n当前消息：\n${input.message}`,
        timestamp: Date.now(),
      }],
    }, { signal: input.signal });
    const text = response.content.flatMap(block => block.type === "text" ? [block.text] : []).join("").trim();
    return parseRewriteResult(text);
  }
}

export function parseRewriteResult(text: string): string[] {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const parsed = rewriteResult.safeParse(JSON.parse(cleaned));
  if (!parsed.success) throw new Error("Invalid query rewrite response");
  return [...new Set(parsed.data.queries.map(query => query.trim()).filter(Boolean))].slice(0, 2);
}
