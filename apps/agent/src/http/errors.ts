import type { Context } from "hono";
import { SessionBusyError, SessionNotFoundError, SessionOwnershipError } from "../agent/session.js";

export function sessionError(c: Context, cause: unknown): Response {
  if (cause instanceof SessionNotFoundError) return c.json({ error: "Session not found" }, 404);
  if (cause instanceof SessionOwnershipError) return c.json({ error: "Session belongs to another user" }, 403);
  if (cause instanceof SessionBusyError) return c.json({ error: "Session is already running" }, 409);
  throw cause;
}
