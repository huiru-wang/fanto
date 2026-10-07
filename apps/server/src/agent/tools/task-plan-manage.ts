import { Type } from "typebox";
import type { Context } from "@earendil-works/pi-agent-core";
import type { AgentBusinessServices } from "../business-services.js";
import { createRunContext } from "../context/index.js";
import type { TaskPlanAction, TaskRunPlan } from "../../domain/tasks/index.js";
import type { FantoTool } from "./types.js";

const stepSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 60, pattern: "^[a-zA-Z0-9_-]+$" }),
  title: Type.String({ minLength: 1, maxLength: 160 }),
  description: Type.Optional(Type.String({ minLength: 1, maxLength: 400 })),
}, { additionalProperties: false });

const schema = Type.Object({
  action: Type.Union([Type.Literal("create"), Type.Literal("update")]),
  summary: Type.String({ minLength: 1, maxLength: 800, description: "用户能理解的整体执行思路，不写工具、文件路径或内部协议。" }),
  steps: Type.Array(stepSchema, { minItems: 1, maxItems: 8 }),
}, { additionalProperties: false });

function requestContext(context: Context) {
  const run = createRunContext.read(context);
  return {
    userId: run.userId,
    traceId: run.traceId,
    signal: context.abortSignal,
    sessionId: run.sessionId,
    timeZone: run.timeZone,
    task: run.task,
  };
}

export function createTaskPlanManageTool(
  client: Pick<AgentBusinessServices, "manageTaskPlan">,
): FantoTool<typeof schema, { plan: TaskRunPlan }> {
  return {
    name: "task_plan_manage",
    label: "管理任务计划",
    presentation: {
      visible: true,
      start: { displayContent: "🧩 正在整理执行计划...", animation: "working" },
      succeeded: { displayContent: "✓ 执行计划已整理" },
      failed: { displayContent: "执行计划没有整理完成" },
    },
    description: [
      "在资料理解充分后、开始制作结果前建立用户可读的执行计划。",
      "首次使用 action=create；如果后续发现计划需要调整，使用 action=update 整体替换计划。",
      "计划只写用户能理解的工作阶段，不写 record_read、bash、文件路径、mediaId、fanto-media、deliver_task_result 等内部执行细节。",
      "暂不需要逐步更新完成状态。",
    ].join("\n"),
    parameters: schema,
    executionMode: "sequential",
    replay: "never",
    async execute(_toolCallId, params, _onUpdate, _toolContext, _invocation, context) {
      const plan = await client.manageTaskPlan(requestContext(context), {
        action: params.action as TaskPlanAction,
        plan: {
          summary: params.summary.trim(),
          steps: params.steps.map(step => ({
            id: step.id.trim(),
            title: step.title.trim(),
            ...(step.description?.trim() ? { description: step.description.trim() } : {}),
          })),
        },
      });
      createRunContext.read(context).taskPlanReady = true;
      return {
        content: [{ type: "text" as const, text: params.action === "create" ? "任务计划已建立。" : "任务计划已更新。" }],
        details: { plan },
      };
    },
  };
}
