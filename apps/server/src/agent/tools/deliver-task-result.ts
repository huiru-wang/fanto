import { Type } from "typebox";
import type { AgentHarnessTool, Context, ExecutionToolContext } from "@earendil-works/pi-agent-core";
import type { AgentBusinessServices } from "../business-services.js";
import { createRunContext } from "../context/index.js";

const schema = Type.Object({
  summary: Type.String({ minLength: 1, maxLength: 1000, description: "面向用户的简短交付摘要。" }),
  artifacts: Type.Array(Type.Object({
    path: Type.String({ minLength: 1, maxLength: 200, description: "工作区根目录下的相对文件路径，例如 result.html。" }),
    role: Type.Union([Type.Literal("primary"), Type.Literal("supplementary")]),
  }, { additionalProperties: false }), { minItems: 1, maxItems: 10 }),
}, { additionalProperties: false });

export function createDeliverTaskResultTool(
  client: Pick<AgentBusinessServices, "deliverTaskResult">,
  workspace: string,
): AgentHarnessTool<ExecutionToolContext, typeof schema, unknown> {
  return {
    name: "deliver_task_result",
    label: "交付任务结果",
    description: "提交最终任务文件。先以相对路径写入工作区文件，再调用本工具。工具会校验文件并上传；失败提示会说明需要如何修复后重试。",
    parameters: schema,
    executionMode: "sequential",
    replay: "never",
    async execute(_toolCallId, params, _onUpdate, _toolContext, _invocation, context) {
      const run = createRunContext.read(context);
      const result = await client.deliverTaskResult({
        userId: run.userId,
        traceId: run.traceId,
        signal: context.abortSignal,
        sessionId: run.sessionId,
        timeZone: run.timeZone,
        task: run.task,
        workspace,
      }, params);
      return {
        content: [{ type: "text" as const, text: "任务结果已交付。" }],
        details: result,
      };
    },
  };
}
