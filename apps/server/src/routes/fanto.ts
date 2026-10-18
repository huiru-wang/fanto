import { Hono } from "hono";
import { FantoError, settingsPatchSchema, type FantoService } from "../domain/fanto/index.js";
import { requireUserId } from "./request-user.js";
const ok = (result: unknown) => ({ success: true, result, errorCode: null, errorMsg: null });
export function createFantoRoutes(service: FantoService) {
    const app = new Hono();
    app.get("/settings", async (c) => c.json(ok(await service.getSettings(requireUserId(c.req.raw)))));
    app.patch("/settings", async (c) => {
        const parsed = settingsPatchSchema.safeParse(await c.req.json().catch(() => null));
        if (!parsed.success)
            return c.json({ success: false, result: null, errorCode: "INVALID_INPUT", errorMsg: "设置内容不合法，请检查长度与字段。" }, 400);
        try {
            return c.json(ok(await service.updateSettings(requireUserId(c.req.raw), parsed.data)));
        }
        catch (error) {
            if (error instanceof FantoError)
                return c.json({ success: false, result: null, errorCode: error.code, errorMsg: error.message }, error.status);
            throw error;
        }
    });
    return app;
}
