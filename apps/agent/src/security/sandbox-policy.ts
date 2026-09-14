import type { BashExecution } from "@earendil-works/pi-agent-core";

const forbiddenBash = /(^|[\s;|&])(sudo\b|su\b|mount\b|umount\b|ssh\b|curl\b|wget\b|nc\b|chmod\s+-R|chown\s+-R|rm\s+-[a-z]*r)/;
export const MAX_BASH_TIMEOUT_MS = 30_000;

export function prepareBashExecution(execution: BashExecution, workspace: string): void {
  if (forbiddenBash.test(execution.command)) throw new Error("Command is not permitted in the agent workspace");
  execution.cwd = workspace;
  execution.env = {};
  execution.inheritEnv = false;
}

export function assertBashRequest(args: unknown): void {
  if (!args || typeof args !== "object") throw new Error("Invalid bash request");
  const timeout = (args as Record<string, unknown>).timeout;
  if (typeof timeout === "number" && timeout > MAX_BASH_TIMEOUT_MS) throw new Error("Bash timeout exceeds the permitted maximum");
}
