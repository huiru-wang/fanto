import { Hono } from "hono";
import type { ProjectService } from "../domain/projects/index.js";
import { requireUserId } from "./request-user.js";

const ok = (result: unknown) => ({ success: true, result, errorCode: null, errorMsg: null });
const clampLimit = (raw: string | undefined, fallback: number) => Math.min(Math.max(Number(raw ?? fallback) || fallback, 1), 100);

export function createProjectRoutes(service: ProjectService) {
  const app = new Hono();

  app.get("/projects", async c => {
    const status = service.parseStatus(c.req.query("status"));
    if (status === null) return c.json({ success: false, errorCode: "INVALID_INPUT", errorMsg: "Invalid project status" }, 400);
    const result = await service.list(requireUserId(c.req.raw), status, c.req.query("cursor"), clampLimit(c.req.query("limit"), 20));
    return result.kind === "ok"
      ? c.json(ok({ data: result.data, hasMore: result.hasMore, nextCursor: result.nextCursor, pageSize: result.pageSize }))
      : c.json({ success: false, errorCode: "INVALID_CURSOR", errorMsg: "Invalid project cursor" }, 400);
  });

  app.get("/projects/:id", async c => {
    const project = await service.find(requireUserId(c.req.raw), c.req.param("id"));
    return project ? c.json(ok(project)) : c.json({ success: false, errorCode: "NOT_FOUND", errorMsg: "Project not found" }, 404);
  });

  app.get("/projects/:id/records", async c => {
    const result = await service.recordsPage(requireUserId(c.req.raw), c.req.param("id"), c.req.query("cursor"), clampLimit(c.req.query("limit"), 5));
    if (result.kind === "ok") return c.json(ok({ data: result.data, hasMore: result.hasMore, nextCursor: result.nextCursor, pageSize: result.pageSize }));
    if (result.kind === "not_found") return c.json({ success: false, errorCode: "NOT_FOUND", errorMsg: "Project not found" }, 404);
    if (result.kind === "invalid_cursor") return c.json({ success: false, errorCode: "INVALID_CURSOR", errorMsg: "Invalid project record cursor" }, 400);
    return c.json({ success: false, errorCode: "INTEGRITY_ERROR", errorMsg: "Missing linked record" }, 500);
  });

  app.post("/projects/:id/confirm", async c => {
    const result = await service.confirm(requireUserId(c.req.raw), c.req.param("id"));
    if (result.kind === "ok") return c.json(ok(result.project));
    return c.json({ success: false, errorCode: result.kind === "not_found" ? "NOT_FOUND" : "INVALID_STATE", errorMsg: result.kind === "not_found" ? "Project not found" : "Project cannot be confirmed" }, result.kind === "not_found" ? 404 : 409);
  });

  app.post("/projects/:id/reject", async c => {
    const result = await service.reject(requireUserId(c.req.raw), c.req.param("id"));
    if (result.kind === "ok") return c.json(ok(result.project));
    return c.json({ success: false, errorCode: result.kind === "not_found" ? "NOT_FOUND" : "INVALID_STATE", errorMsg: result.kind === "not_found" ? "Project not found" : "Project cannot be rejected" }, result.kind === "not_found" ? 404 : 409);
  });

  return app;
}
