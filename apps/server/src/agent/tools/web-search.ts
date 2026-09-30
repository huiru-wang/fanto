import { Type } from "typebox";
import type { AgentHarnessTool, Context, ExecutionToolContext } from "@earendil-works/pi-agent-core";
import type { AgentBusinessServices } from "../business-services.js";
import { createRunContext } from "../context/index.js";
import type { WebSearchResult } from "../web/deepseek-web-search.js";

const schema = Type.Object({
  query: Type.String({ minLength: 1, maxLength: 500, description: "需要从公开网页查证或补充的具体问题。" }),
}, { additionalProperties: false });

function requestContext(context: Context) {
  const run = createRunContext.read(context);
  return { userId: run.userId, traceId: run.traceId, signal: context.abortSignal, sessionId: run.sessionId, timeZone: run.timeZone, task: run.task };
}

export function createWebSearchTool(
  client: Pick<AgentBusinessServices, "searchWeb">,
): AgentHarnessTool<ExecutionToolContext, typeof schema, WebSearchResult> {
  return {
    name: "web_search",
    label: "搜索公开资料",
    description: "当任务缺少会影响结果的公开、当前或可查证信息时搜索网页。用户自己的经历和素材优先使用 Record Tools；稳定常识不需要搜索。搜索结果包含来源 URL，不得编造来源。",
    parameters: schema,
    executionMode: "parallel",
    replay: "safe",
    async execute(_toolCallId, params, _onUpdate, _toolContext, _invocation, context) {
      const details = await client.searchWeb(requestContext(context), params.query);
      return { content: [{ type: "text" as const, text: JSON.stringify(details) }], details };
    },
  };
}
