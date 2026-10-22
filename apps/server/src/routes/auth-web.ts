import { Hono } from "hono";
import { z } from "zod";
import type { AuthService } from "../domain/auth/auth-service.js";
import { AuthError } from "../domain/auth/errors.js";

const COOKIE = "__Host-fanto-session";
const INTENT_COOKIE = "__Host-fanto-google-intent";
const proofSchema = z.object({ intentId: z.string().uuid(), proof: z.object({ idToken: z.string().min(1) }).strict() }).strict();
const ok = (result: unknown) => ({ success: true, result, errorCode: null, errorMsg: null });
const errorResult = (cause: AuthError) => ({ success: false, result: null, errorCode: cause.code, errorMsg: cause.message });
export const webSessionCookieName = COOKIE;
export function webCookie(request: Request) {
  const field = request.headers.get("Cookie") ?? "";
  return field.split(";").map(part => part.trim()).find(part => part.startsWith(COOKIE + "="))?.slice(COOKIE.length + 1) || null;
}
export function createWebAuthRoutes(service: AuthService, webOrigin: string) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    // Google GIS redirect sends a form POST, not our JSON+custom-header protocol.
    if (c.req.path.endsWith("/redirect")) return next();
    if (c.req.header("Origin") !== webOrigin || c.req.header("X-Fanto-Web") !== "1" ||
        !c.req.header("content-type")?.toLowerCase().startsWith("application/json")) {
      return c.json(errorResult(new AuthError(403, "INVALID_ORIGIN", "Invalid web request origin")), 403);
    }
    c.header("Cache-Control", "no-store");
    await next();
  });
  app.post("/intents", async c => {
    const body = z.object({ purpose: z.literal("authenticate"), provider: z.literal("google") }).strict().safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(errorResult(new AuthError(400, "INVALID_INPUT", "Invalid request")), 400);
    try {
      const intent = await service.createIntent("authenticate", "google", undefined, "web");
      c.header("Set-Cookie", `${INTENT_COOKIE}=${intent.intentId}; Path=/; Max-Age=600; Secure; HttpOnly; SameSite=None`);
      return c.json(ok(intent));
    }
    catch (cause) { if (cause instanceof AuthError) return c.json(errorResult(cause), cause.status); throw cause; }
  });
  app.post("/authentications", async c => {
    const body = proofSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(errorResult(new AuthError(400, "INVALID_INPUT", "Invalid request")), 400);
    try {
      const { sessionToken, ...result } = await service.authenticate(body.data.intentId, body.data.proof, "web");
      c.header("Set-Cookie", `${COOKIE}=${sessionToken}; Path=/; Max-Age=2592000; Secure; HttpOnly; SameSite=Lax`);
      return c.json(ok({ user: result.user }));
    } catch (cause) { if (cause instanceof AuthError) return c.json(errorResult(cause), cause.status); throw cause; }
  });
  app.post("/redirect", async c => {
    c.header("Cache-Control", "no-store");
    // Google GIS documents the g_csrf_token double-submit requirement.
    const raw = await c.req.text();
    if (raw.length > 12_000 || !c.req.header("content-type")?.startsWith("application/x-www-form-urlencoded")) {
      return c.json(errorResult(new AuthError(400, "INVALID_INPUT", "Invalid Google redirect")), 400);
    }
    const form = new URLSearchParams(raw);
    const getCookieValue = (key: string) => (c.req.header("Cookie") ?? "").split(";")
      .map(part => part.trim()).find(part => part.startsWith(key + "="))?.slice(key.length + 1);
    const csrf = form.get("g_csrf_token");
    const intentId = getCookieValue(INTENT_COOKIE);
    if (!csrf || csrf !== getCookieValue("g_csrf_token") || !intentId ||
        !z.string().uuid().safeParse(intentId).success || !form.get("credential")) {
      return c.json(errorResult(new AuthError(403, "INVALID_ORIGIN", "Google login CSRF check failed")), 403);
    }
    try {
      const { sessionToken } = await service.authenticate(intentId, { idToken: form.get("credential") }, "web");
      c.header("Set-Cookie", `${COOKIE}=${sessionToken}; Path=/; Max-Age=2592000; Secure; HttpOnly; SameSite=Lax`, { append: true });
      c.header("Set-Cookie", `${INTENT_COOKIE}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=None`, { append: true });
      return c.redirect("/chat", 303);
    } catch (cause) {
      if (cause instanceof AuthError) return c.json(errorResult(cause), cause.status);
      throw cause;
    }
  });

  app.post("/logout", async c => {
    try {
      const token = webCookie(c.req.raw);
      if (token) await service.sessions.revoke(token, "web");
      c.header("Set-Cookie", `${COOKIE}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`);
      return c.body(null, 204);
    } catch (cause) { if (cause instanceof AuthError) return c.json(errorResult(cause), cause.status); throw cause; }
  });
  return app;
}
