import { randomUUID } from "node:crypto";
import { logError, logInfo } from "./logger.js";

/** Metadata only: never log request/response bodies, URLs or SDK error messages. */
export async function logExternalCall<T>(service: string, operation: string,
  details: Record<string, unknown>, call: () => Promise<T>): Promise<T> {
  const callId = randomUUID();
  const startedAt = performance.now();
  logInfo("external-call", "started", { service, operation, callId, ...details });
  try {
    const result = await call();
    logInfo("external-call", "completed", { service, operation, callId, ...details,
      outcome: "succeeded", durationMs: Math.round((performance.now() - startedAt) * 100) / 100 });
    return result;
  } catch (error) {
    const failure = error as { name?: unknown; code?: unknown; status?: unknown; statusCode?: unknown; cause?: { code?: unknown }; diagnostics?: { stage?: unknown; reason?: unknown; httpStatus?: unknown } } | null;
    const identifier = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(value) ? value : undefined;
    logError("external-call", "failed", { service, operation, callId, ...details,
      outcome: "failed", durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
      errorName: identifier(failure?.name), errorCode: identifier(failure?.code), causeCode: identifier(failure?.cause?.code),
      ...(typeof (failure?.status ?? failure?.statusCode) === "number" ? { httpStatus: failure?.status ?? failure?.statusCode } : {}),
      stage: identifier(failure?.diagnostics?.stage), reason: identifier(failure?.diagnostics?.reason),
      ...(typeof failure?.diagnostics?.httpStatus === "number" ? { httpStatus: failure.diagnostics.httpStatus } : {}) });
    throw error;
  }
}
