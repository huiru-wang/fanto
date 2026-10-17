import type { AgentHarness, ExecutionToolContext } from "@earendil-works/pi-agent-core";
import { createRunContext } from "../context/run-context.js";

/** User stop is a scheduling boundary, not a cancellation signal for tools already running. */
export type StopState = { requested: boolean; tools: number };

export function installStopHooks(harness: AgentHarness<ExecutionToolContext>): void {
  harness.hooks.on("before_tool", (_event, context) => {
    if (createRunContext.read(context).stop?.requested) return { block: { reason: "User stopped this turn", terminate: true } };
    return undefined;
  });
  harness.hooks.on("after_tool", (_event, context) => {
    if (createRunContext.read(context).stop?.requested) return { terminate: true };
    return undefined;
  });
  harness.hooks.on("before_request", (_event, context) => {
    if (createRunContext.read(context).stop?.requested) throw new DOMException("user_stop", "AbortError");
    return undefined;
  });
}
