import { Hono } from "hono";
import { z } from "zod";
import { requireUserId } from "./request-user.js";
import { AdminInvalidCursor, AdminNotFound, type AdminService } from "../domain/admin/index.js";

const listUsersSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).max(512).optional(),
  query: z.string().trim().min(1).max(100).optional(),
  status: z.enum(["active", "disabled"]).optional(),
});
const listSessionsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).max(512).optional(),
  agentId: z.string().trim().min(1).max(64).optional(),
});
const ok = (result: unknown) => ({ success: true as const, result, errorCode: null, errorMsg: null });
const fail = (errorCode: string, errorMsg: string) => ({ success: false as const, result: null, errorCode, errorMsg });

/** Must be mounted *after* common Access JWT authentication middleware. */
export function createAdminRoutes(service: AdminService, adminUserIds: ReadonlySet<string>): Hono {
  const app = new Hono();
  app.use("*", async (c, next) => {
    if (!adminUserIds.has(requireUserId(c.req.raw)))
      return c.json(fail("FORBIDDEN", "Admin access required"), 403);
    await next();
  });
  app.onError((error, c) => {
    if (error instanceof AdminNotFound) return c.json(fail("NOT_FOUND", error.message), 404);
    if (error instanceof AdminInvalidCursor) return c.json(fail("INVALID_CURSOR", error.message), 400);
    throw error;
  });
  app.get("/users", async c => {
    const parsed = listUsersSchema.safeParse(c.req.query());
    return parsed.success ? c.json(ok(await service.users(parsed.data))) : c.json(fail("INVALID_INPUT", "Invalid user list query"), 400);
  });
  app.get("/users/:userId", async c => c.json(ok(await service.user(c.req.param("userId")))));
  app.get("/users/:userId/usage", async c => c.json(ok(await service.userUsage(c.req.param("userId")))));
  app.get("/users/:userId/sessions", async c => {
    const parsed = listSessionsSchema.safeParse(c.req.query());
    return parsed.success ? c.json(ok(await service.sessions(c.req.param("userId"), parsed.data)))
      : c.json(fail("INVALID_INPUT", "Invalid session list query"), 400);
  });
  app.get("/sessions/:sessionId/usage", async c => c.json(ok(await service.sessionUsage(c.req.param("sessionId")))));
  return app;
}
