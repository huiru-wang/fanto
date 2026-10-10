import { logSummary } from "../../infrastructure/logging/logger.js";
import { logRunEvent } from "./run-logging.js";
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
    if ([...planRequiredTools, "read", "task_plan_manage"].includes(toolName) && !run.taskAuthorized) {
      return { block: { reason: "TASK_AUTHORITY_REQUIRED", terminate: true } };
    }
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
  const requests=new WeakMap<object,number>();
  harness.hooks.on("before_request", async (event,context) => {
    const data=createRunContext.read(context);
    requests.set(data,Date.now());
    logRunEvent(data,"model request started",{provider:event.model.provider,model:event.model.id,step:event.step,attempt:event.attempt,timeoutMs:event.streamOptions.timeoutMs});
    return undefined;
  });
  harness.hooks.on("before_payload", async () => undefined);
  harness.hooks.on("after_response", async (event,context) => {
    const data=createRunContext.read(context);
    const startedAt=requests.get(data);
    logRunEvent(data,"model response completed",{httpStatus:event.status,stopReason:event.message.stopReason,error:event.message.errorMessage?logSummary(event.message.errorMessage):undefined,durationMs:startedAt===undefined?undefined:Date.now()-startedAt});
    requests.delete(data);
    return undefined;
  });
  harness.hooks.on("after_tool", async ({ toolName, isError }) => {
    if (["deliver_task_result", "collect_user_input", "proposal_create"].includes(toolName) && !isError) return { terminate: true };
    return undefined;
  });
  harness.hooks.on("before_compaction", async () => undefined);
  harness.hooks.on("before_navigation", async () => undefined);
}
