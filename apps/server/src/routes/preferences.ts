import { Hono } from "hono";
import { z } from "zod";
import type { PreferenceService } from "../domain/preferences/preference-service.js";
import { requireUserId } from "./request-user.js";

const category = z.enum(["communication", "scenario", "lifestyle"]);
const source = z.object({
  sessionId: z.string().min(1).max(128),
  messageId: z.string().min(1).max(256),
  quote: z.string().trim().min(1).max(1_000),
}).strict();
const createInput = z.object({
  category,
  content: z.string().trim().min(1).max(2_000),
  source,
}).strict();
const updateInput = z.object({
  expectedVersion: z.number().int().positive(),
  category,
  content: z.string().trim().min(1).max(2_000),
  source,
}).strict();
const deleteInput = z.object({ expectedVersion: z.number().int().positive() }).strict();

const envelope = (result: unknown) => ({ success: true, result, errorCode: null, errorMsg: null });

function mutationError(c: any, result: { kind: string; preference?: unknown }) {
  if (result.kind === "not_found") return c.json({ success: false, errorCode: "NOT_FOUND", errorMsg: "Preference not found" }, 404);
  return c.json({ success: false, result: result.preference ?? null, errorCode: "VERSION_CONFLICT", errorMsg: "Preference was changed by another update" }, 409);
}

export function createPreferenceRoutes(service: PreferenceService) {
  const app = new Hono();

  app.get("/", async c => c.json(envelope({ data: await service.list(requireUserId(c.req.raw)) })));

  app.post("/", async c => {
    const body = createInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ success: false, errorCode: "INVALID_INPUT", errorMsg: body.error.message }, 400);
    const result = await service.create({ userId: requireUserId(c.req.raw), ...body.data });
    if (result.kind === "limit_reached") {
      return c.json({ success: false, errorCode: "PREFERENCE_LIMIT_REACHED", errorMsg: "Preference limit reached" }, 409);
    }
    return c.json(envelope({ preference: result.preference, reused: result.reused }), result.reused ? 200 : 201);
  });

  app.patch("/:id", async c => {
    const body = updateInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ success: false, errorCode: "INVALID_INPUT", errorMsg: body.error.message }, 400);
    const result = await service.update({
      userId: requireUserId(c.req.raw),
      preferenceId: c.req.param("id"),
      ...body.data,
    });
    return result.kind === "ok" ? c.json(envelope(result.preference)) : mutationError(c, result);
  });

  app.delete("/:id", async c => {
    const body = deleteInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ success: false, errorCode: "INVALID_INPUT", errorMsg: body.error.message }, 400);
    const result = await service.delete({
      userId: requireUserId(c.req.raw),
      preferenceId: c.req.param("id"),
      expectedVersion: body.data.expectedVersion,
    });
    return result.kind === "ok" ? c.json(envelope({ preferenceId: result.preference.preferenceId })) : mutationError(c, result);
  });

  return app;
}
