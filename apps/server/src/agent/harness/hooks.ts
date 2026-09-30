import type { AgentHarness, ExecutionToolContext } from "@earendil-works/pi-agent-core";
import type { createSystemPrompt } from "../context/index.js";
import { createRunContext } from "../context/index.js";
import type { MessageTransform } from "../context/transform-context.js";
import { assertBashRequest } from "../workspace/bash.js";
import { assertWorkspacePath } from "../workspace/paths.js";

const planRequiredTools = new Set(["write", "edit", "bash", "deliver_task_result"]);

export function installHarnessHooks(
  harness: AgentHarness<ExecutionToolContext>,
  options: { workspace: string; systemPrompt: ReturnType<typeof createSystemPrompt>; transformContext: MessageTransform },
): void {
  harness.hooks.on("transform_context", async (event, context) => {
    const messages = await options.transformContext(event.messages, context);
    return messages ? { messages: [...messages] } : undefined;
  });
  harness.hooks.on("before_tool", ({ toolName, args }, context) => {
    const run = createRunContext.read(context);
    if (run.task && planRequiredTools.has(toolName) && !run.taskPlanReady) {
      return { block: { reason: "开始制作或交付结果前，必须先调用 task_plan_manage(action=create) 保存用户可读的执行计划。" } };
    }
    if (["read", "write", "edit"].includes(toolName) && args && typeof args === "object") {
      const path = (args as Record<string, unknown>).path;
      if (typeof path !== "string") return { block: { reason: "A file path is required", terminate: true } };
      try { assertWorkspacePath(options.workspace, path); }
      catch (cause) { return { block: { reason: cause instanceof Error ? cause.message : "Invalid workspace path", terminate: true } }; }
    }
    if (toolName === "bash") {
      try { assertBashRequest(args); }
      catch (cause) { return { block: { reason: cause instanceof Error ? cause.message : "Invalid bash request", terminate: true } }; }
    }
    return undefined;
  });
  harness.hooks.on("before_run_end", async (_event, context) => { options.systemPrompt.release(context); return undefined; });
  harness.hooks.on("before_run", async () => undefined);
  harness.hooks.on("before_drive", async () => undefined);
  harness.hooks.on("before_request", async () => undefined);
  harness.hooks.on("before_payload", async () => undefined);
  harness.hooks.on("after_response", async () => undefined);
  harness.hooks.on("after_tool", async ({ toolName, isError }) => {
    if ((toolName === "deliver_task_result" || toolName === "collect_user_input") && !isError) return { terminate: true };
    return undefined;
  });
  harness.hooks.on("before_compaction", async () => undefined);
  harness.hooks.on("before_navigation", async () => undefined);
}
