import type { AgentHarness, ExecutionToolContext } from "@earendil-works/pi-agent-core";
import type { createSystemPrompt } from "../context/index.js";
import type { MessageTransform } from "../context/transform-context.js";
import { assertBashRequest } from "../workspace/bash.js";
import { assertWorkspacePath } from "../workspace/paths.js";

export function installHarnessHooks(
  harness: AgentHarness<ExecutionToolContext>,
  options: { workspace: string; systemPrompt: ReturnType<typeof createSystemPrompt>; transformContext: MessageTransform },
): void {
  harness.hooks.on("transform_context", async (event, context) => {
    const messages = await options.transformContext(event.messages, context);
    return messages ? { messages: [...messages] } : undefined;
  });
  harness.hooks.on("before_tool", ({ toolName, args }) => {
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
  harness.hooks.on("after_tool", async () => undefined);
  harness.hooks.on("before_compaction", async () => undefined);
  harness.hooks.on("before_navigation", async () => undefined);
}
