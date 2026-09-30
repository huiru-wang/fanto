import { Type } from "typebox";
import type { Context } from "@earendil-works/pi-agent-core";
import type { AgentBusinessServices } from "../business-services.js";
import { createRunContext } from "../context/index.js";
import type { FantoTool } from "./types.js";

const schema = Type.Object({
  summary: Type.String({ minLength: 1, maxLength: 1000, description: "面向用户的简短交付摘要，只说明完成了什么。不要写文件路径、内部文件名、mediaId、fanto-media、Workspace、Tool、图片替换方式或打开文件的方法。" }),
  artifacts: Type.Array(Type.Object({
    path: Type.String({ minLength: 1, maxLength: 200, description: "工作区根目录下的相对文件路径，例如 result.html。" }),
    role: Type.Union([Type.Literal("primary"), Type.Literal("supplementary")]),
  }, { additionalProperties: false }), { minItems: 1, maxItems: 10 }),
}, { additionalProperties: false });

export function createDeliverTaskResultTool(
  client: Pick<AgentBusinessServices, "deliverTaskResult">,
  workspace: string,
): FantoTool<typeof schema, unknown> {
  return {
    name: "deliver_task_result",
    label: "交付任务结果",
    presentation: { visible: false },
    description: "提交最终任务成品。先完成并自检所有结果文件，再调用本工具。summary 会直接展示给用户，只描述完成结果，不解释 Fanto 内部交付方式。校验失败时修复后重试。",
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
