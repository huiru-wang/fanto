import { Hono } from "hono";
import { z } from "zod";
import { CreativeError } from "../creative-runtime/model.js";
import type { CreativeService } from "../creative-runtime/service.js";
import { requireUserId } from "./request-user.js";
export function createCreativeRoutes(service: CreativeService) {
  const app = new Hono();
  const ok = (result: unknown) => ({ success: true, result, errorCode: null, errorMsg: null });
  app.onError((error, c) => {
    if (!(error instanceof CreativeError)) throw error;
    return c.json({ success: false, result: null, errorCode: error.code, errorMsg: error.code }, error.code === "NOT_FOUND" ? 404 : error.code === "INVALID_INPUT" ? 400 : 409);
  });
  app.get("/projects/:id/creation", async c => {
    if (!z.string().uuid().safeParse(c.req.param("id")).success) throw new CreativeError("INVALID_INPUT");
    const result = await service.latest(requireUserId(c.req.raw), c.req.param("id"));
    if (!result) throw new CreativeError("NOT_FOUND");
    return c.json(ok(result));
  });
  app.get("/records/:id/proposal-analysis", async c => {
    const result = await service.analysisStatus(requireUserId(c.req.raw), c.req.param("id"));
    if (!result) throw new CreativeError("NOT_FOUND");
    return c.json(ok(result));
  });
  return app;
}
