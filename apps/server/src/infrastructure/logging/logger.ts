import { appendFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { nowIso } from "../time.js";

const logDir = process.env.LOG_DIR ?? resolve(process.cwd(), "../..", "logs");

function write(file: "service.log" | "agent.log" | "access.log", line: string) {
  mkdirSync(logDir, { recursive: true });
  appendFileSync(resolve(logDir, file), `${line}\n`);
}

export function logInfo(scope: string, message: string, details?: Record<string, unknown>) {
  write("service.log", formatLog("info", scope, message, details));
}

export function logWarn(scope: string, message: string, details?: Record<string, unknown>) {
  write("service.log", formatLog("warn", scope, message, details));
}

export function logError(scope: string, message: string, details?: Record<string, unknown>) {
  write("service.log", formatLog("error", scope, message, details));
}

export function logAgent(level: "info" | "warn" | "error", scope: string, message: string, details?: Record<string, unknown>) {
  write("agent.log", formatLog(level, scope, message, details));
}


export function logAccess(input: { path: string; method: string; requestBody: unknown; responseBody: unknown; status: number }) {
  write("access.log", JSON.stringify({ at: nowIso(), ...input }));
}

function formatLog(level: string, scope: string, message: string, details?: Record<string, unknown>) {
  const payload = details ? ` ${JSON.stringify(details)}` : "";
  return `[${nowIso()}] [${level}] [${scope}] ${message}${payload}`;
}

/** Safe, bounded summaries for business decisions and external errors. */
export function logSummary(value: unknown): string {
  return (value instanceof Error ? value.message : String(value))
    .replace(/https?:\/\/[^\s<>"']+/gi, "[URL REDACTED]")
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/((?:authorization|password|secret|token|api[_-]?key)\s*[=:]\s*)[^\s,;]+/gi, "$1[REDACTED]")
    .slice(0, 1000);
}
