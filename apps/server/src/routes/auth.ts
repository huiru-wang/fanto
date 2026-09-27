import { Hono } from "hono";
import { z } from "zod";
import type { AuthService } from "../domain/auth/service.js";
import type { ChallengePurpose, IdentityProviderName } from "../domain/auth/identity-provider.js";
import { AuthError } from "../domain/auth/errors.js";
import { requireUserId } from "./request-user.js";

const providerSchema = z.enum(["google", "apple", "phone"]);
const publicIntentSchema = z.object({
  purpose: z.enum(["authenticate", "register", "login"]),
  provider: providerSchema,
}).strict();
const identityIntentSchema = z.object({ provider: providerSchema }).strict();
const proofSchema = z.object({
  intentId: z.string().uuid(),
  proof: z.record(z.string(), z.unknown()),
}).strict();
const refreshSchema = z.object({ refreshToken: z.string().min(1) }).strict();
const unlinkSchema = z.object({
  reauth: z.object({
    intentId: z.string().uuid(),
    proof: z.record(z.string(), z.unknown()),
  }).strict(),
}).strict();

const ok = (result: unknown) => ({ success: true as const, result, errorCode: null, errorMsg: null });
const fail = (error: AuthError) => ({ success: false as const, result: null, errorCode: error.code, errorMsg: error.message });

class FixedWindowLimiter {
  private readonly buckets = new Map<string, { start: number; count: number }>();
  constructor(private readonly limit = 60, private readonly windowMs = 60_000) {}
  allow(key: string): boolean {
    const timestamp = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket || timestamp - bucket.start >= this.windowMs) {
      this.buckets.set(key, { start: timestamp, count: 1 });
      return true;
    }
    bucket.count += 1;
    return bucket.count <= this.limit;
  }
}

export function createAuthRoutes(service: AuthService): Hono {
  const app = new Hono();
  const limiter = new FixedWindowLimiter();

  app.use("*", async (c, next) => {
    const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
    const remote = forwarded || c.req.header("x-real-ip")?.trim() || "unknown";
    const fingerprint = c.req.header("x-client-fingerprint")?.trim() || "none";
    if (!limiter.allow(remote + ":" + fingerprint)) {
      return c.json(fail(new AuthError(429, "RATE_LIMITED", "Too many authentication requests")), 429);
    }
    await next();
  });

  app.post("/auth/intents", async c => {
    const body = publicIntentSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(fail(new AuthError(400, "INVALID_INPUT", "Invalid request")), 400);
    try {
      return c.json(ok(await service.createIntent(body.data.purpose as ChallengePurpose, body.data.provider as IdentityProviderName)));
    } catch (cause) {
      return authFailure(c, cause);
    }
  });

  app.post("/auth/registrations", async c => {
    const body = proofSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(fail(new AuthError(400, "INVALID_INPUT", "Invalid request")), 400);
    try {
      return c.json(ok(await service.register(body.data.intentId, body.data.proof)), 201);
    } catch (cause) {
      return authFailure(c, cause);
    }
  });

  app.post("/auth/logins", async c => {
    const body = proofSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(fail(new AuthError(400, "INVALID_INPUT", "Invalid request")), 400);
    try {
      return c.json(ok(await service.login(body.data.intentId, body.data.proof)));
    } catch (cause) {
      return authFailure(c, cause);
    }
  });

  app.post("/auth/authentications", async c => {
    const body = proofSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(fail(new AuthError(400, "INVALID_INPUT", "Invalid request")), 400);
    try {
      return c.json(ok(await service.authenticate(body.data.intentId, body.data.proof)));
    } catch (cause) {
      return authFailure(c, cause);
    }
  });

  app.post("/auth/tokens/refresh", async c => {
    const body = refreshSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(fail(new AuthError(400, "INVALID_INPUT", "Invalid request")), 400);
    try {
      return c.json(ok(await service.refresh(body.data.refreshToken)));
    } catch (cause) {
      return authFailure(c, cause);
    }
  });

  app.get("/users/me", async c => {
    try {
      return c.json(ok(await service.me(requireUserId(c.req.raw))));
    } catch (cause) {
      return authFailure(c, cause);
    }
  });

  app.post("/users/me/identities/intents", async c => {
    const body = identityIntentSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(fail(new AuthError(400, "INVALID_INPUT", "Invalid request")), 400);
    try {
      return c.json(ok(await service.createIntent("bind", body.data.provider as IdentityProviderName, requireUserId(c.req.raw))));
    } catch (cause) {
      return authFailure(c, cause);
    }
  });

  app.post("/users/me/identities", async c => {
    const body = proofSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(fail(new AuthError(400, "INVALID_INPUT", "Invalid request")), 400);
    try {
      return c.json(ok(await service.bindIdentity(requireUserId(c.req.raw), body.data.intentId, body.data.proof)), 201);
    } catch (cause) {
      return authFailure(c, cause);
    }
  });

  app.post("/users/me/reauth/intents", async c => {
    const body = identityIntentSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(fail(new AuthError(400, "INVALID_INPUT", "Invalid request")), 400);
    try {
      return c.json(ok(await service.createIntent("reauth", body.data.provider as IdentityProviderName, requireUserId(c.req.raw))));
    } catch (cause) {
      return authFailure(c, cause);
    }
  });

  app.delete("/users/me/identities/:identityId", async c => {
    const identityId = z.string().uuid().safeParse(c.req.param("identityId"));
    const body = unlinkSchema.safeParse(await c.req.json().catch(() => null));
    if (!identityId.success || !body.success) return c.json(fail(new AuthError(400, "INVALID_INPUT", "Invalid request")), 400);
    try {
      await service.unlinkIdentity(requireUserId(c.req.raw), identityId.data, body.data.reauth);
      return c.body(null, 204);
    } catch (cause) {
      return authFailure(c, cause);
    }
  });

  return app;
}

function authFailure(c: any, cause: unknown) {
  if (cause instanceof AuthError) return c.json(fail(cause), cause.status);
  throw cause;
}
