import { Hono } from "hono";
import { z } from "zod";
import { RecordService } from "../domain/records/index.js";
import { requireUserId } from "./request-user.js";

const media = z.array(z.unknown());
const location = z.object({
  name: z.string(),
  countryCode: z.string().optional(),
  country: z.string().optional(),
  province: z.string().optional(),
  city: z.string().optional(),
  district: z.string().optional(),
  latitude: z.number(),
  longitude: z.number(),
}).strict();
const createInput = z.object({ text: z.string(), media, location: location.optional(), source: z.string().max(100).optional(), eventAt: z.string().datetime({ offset: true }) }).strict();
const updateInput = z.object({ text: z.string(), media, location: location.nullable().optional(), expectedVersion: z.number().int().positive() }).strict();
const deleteInput = z.object({ expectedVersion: z.number().int().positive() }).strict();
const searchInput = z.object({ query: z.string().trim().min(1), limit: z.number().int().min(1).max(20).optional().default(10) }).strict();
const envelope = (result: unknown) => ({ success: true, result, errorCode: null, errorMsg: null });
function error(c: any, value: string, current?: unknown) { if (value === "not_found") return c.json({ success: false, errorCode: "NOT_FOUND", errorMsg: "Record not found" }, 404); if (value === "conflict") return c.json({ success: false, result: current ?? null, errorCode: "VERSION_CONFLICT", errorMsg: "Record was changed by another edit" }, 409); if (value === "invalid_content") return c.json({ success: false, errorCode: "INVALID_CONTENT", errorMsg: "Record requires text or media" }, 400); return c.json({ success: false, errorCode: "INVALID_MEDIA", errorMsg: "Media is missing, not ready, belongs to another user, or already linked" }, 400); }

export function createRecordRoutes(service: RecordService) {
  const app = new Hono();
  app.post("/", async c => { const body = createInput.safeParse(await c.req.json().catch(() => null)); if (!body.success) return c.json({ success: false, errorCode: "INVALID_INPUT", errorMsg: body.error.message }, 400); try { const result = await service.create(requireUserId(c.req.raw), body.data); return result.kind === "ok" ? c.json(envelope(result.record), 201) : error(c, result.kind); } catch (cause) { return c.json({ success: false, errorCode: "INVALID_INPUT", errorMsg: cause instanceof Error ? cause.message : "Invalid record" }, 400); } });
  app.patch("/:id", async c => { const body = updateInput.safeParse(await c.req.json().catch(() => null)); if (!body.success) return c.json({ success: false, errorCode: "INVALID_INPUT", errorMsg: body.error.message }, 400); try { const result = await service.update(requireUserId(c.req.raw), c.req.param("id"), body.data); return result.kind === "ok" ? c.json(envelope(result.record)) : error(c, result.kind, "current" in result ? result.current : undefined); } catch (cause) { return c.json({ success: false, errorCode: "INVALID_INPUT", errorMsg: cause instanceof Error ? cause.message : "Invalid record" }, 400); } });
  app.delete("/:id", async c => { const body = deleteInput.safeParse(await c.req.json().catch(() => null)); if (!body.success) return c.json({ success: false, errorCode: "INVALID_INPUT", errorMsg: body.error.message }, 400); const result = await service.delete(requireUserId(c.req.raw), c.req.param("id"), body.data.expectedVersion); return result.kind === "ok" ? c.json(envelope({ recordId: result.recordId })) : error(c, result.kind, "current" in result ? result.current : undefined); });
  app.get("/", async c => { try { return c.json(envelope(await service.list(requireUserId(c.req.raw), c.req.query("cursor"), Math.min(Math.max(Number(c.req.query("limit") ?? 10), 1), 100)))); } catch { return c.json({ success: false, errorCode: "INVALID_CURSOR", errorMsg: "Invalid record cursor" }, 400); } });
  app.post("/search", async c => { const body = searchInput.safeParse(await c.req.json().catch(() => null)); if (!body.success) return c.json({ success: false, errorCode: "INVALID_INPUT", errorMsg: body.error.message }, 400); const data = await service.search(requireUserId(c.req.raw), body.data.query, body.data.limit); return c.json(envelope({ data })); });
  app.get("/:id", async c => { const record = await service.find(requireUserId(c.req.raw), c.req.param("id")); return record ? c.json(envelope(record)) : error(c, "not_found"); });
  return app;
}
