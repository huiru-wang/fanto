import assert from "node:assert/strict";
import test from "node:test";
import { createAuthRoutes } from "./auth.js";
import { createWebAuthRoutes } from "./auth-web.js";
import type { AuthService } from "../domain/auth/auth-service.js";
const proof = { intentId: "550e8400-e29b-41d4-a716-446655440000", proof: { idToken: "google-token" } };
const headers = { "Content-Type": "application/json" };
const web = { ...headers, "Origin": "https://fanto.example", "X-Fanto-Web": "1" };
const calls: string[] = [];
const auth = {
  createIntent: async (...args: unknown[]) => { calls.push("intent:" + String(args[3] ?? "native")); return { intentId: proof.intentId }; },
  authenticate: async (_intent: string, _proof: unknown, transport: string) => {
    calls.push("authenticate:" + transport);
    return { user: { userId: "usr1", status: "active" }, sessionToken: "session-secret", idleExpiresAt: "", absoluteExpiresAt: "" };
  },
  sessions: { revoke: async (_token: string, transport: string) => { calls.push("logout:" + transport); } },
} as unknown as AuthService;

test("Native only issues one opaque Session Token; legacy JWT endpoints are gone", async () => {
  const app = createAuthRoutes(auth);
  const response = await app.request("/auth/native/authentications", { method: "POST", headers, body: JSON.stringify(proof) });
  assert.equal(response.status, 200);
  assert.equal((await response.json() as any).result.sessionToken, "session-secret");
  for (const path of ["/auth/authentications", "/auth/logins", "/auth/registrations", "/auth/tokens/refresh"]) {
    assert.equal((await app.request(path, { method: "POST", headers, body: JSON.stringify(proof) })).status, 404);
  }
  const logout = await app.request("/auth/native/logout", { method: "POST", headers: { Authorization: "Bearer session-secret" } });
  assert.equal(logout.status, 204);
  assert.ok(calls.includes("logout:native"));
});

test("Web session is delivered only as secure HttpOnly Cookie with origin protection", async () => {
  const app = createWebAuthRoutes(auth, "https://fanto.example");
  assert.equal((await app.request("/authentications", { method: "POST", headers, body: JSON.stringify(proof) })).status, 403);
  const response = await app.request("/authentications", { method: "POST", headers: web, body: JSON.stringify(proof) });
  assert.equal(response.status, 200);
  const payload = await response.json() as any;
  assert.equal(payload.result.sessionToken, undefined);
  assert.match(response.headers.get("Set-Cookie") ?? "", /__Host-fanto-session=session-secret; Path=\/; Max-Age=2592000; Secure; HttpOnly; SameSite=Lax/);
  assert.equal((await app.request("/logout", { method: "POST", headers: { ...web, Cookie: "__Host-fanto-session=session-secret" }, body: "{}" })).status, 204);
  assert.ok(calls.includes("logout:web"));
});

test("Google redirect checks browser-bound intent and double-submit CSRF before delivering Cookie", async () => {
  const app = createWebAuthRoutes(auth, "https://fanto.example");
  const post = (cookie: string) => app.request("/redirect", { method: "POST", headers: {
    "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie,
  }, body: new URLSearchParams({ g_csrf_token: "check-token", credential: "google-token" }).toString() });
  assert.equal((await post(`__Host-fanto-google-intent=${proof.intentId}`)).status, 403);
  const response = await post(`__Host-fanto-google-intent=${proof.intentId}; g_csrf_token=check-token`);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/chat");
  assert.match(response.headers.get("set-cookie") ?? "", /__Host-fanto-session=session-secret/);
});
