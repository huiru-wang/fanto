import assert from "node:assert/strict";
import test from "node:test";
import { createAuthRoutes } from "./auth.js";
import type { AuthService } from "../domain/auth/service.js";

test("auth routes use provider-neutral contracts", async () => {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const service = {
    createIntent: async (...args: unknown[]) => {
      calls.push({ method: "createIntent", args });
      return { intentId: "550e8400-e29b-41d4-a716-446655440000", provider: "google", expiresAt: "2026-09-27T00:00:00.000Z", challenge: { nonce: "nonce" } };
    },
    register: async (...args: unknown[]) => { calls.push({ method: "register", args }); return {}; },
    login: async (...args: unknown[]) => { calls.push({ method: "login", args }); return {}; },
    refresh: async () => ({}),
  } as unknown as AuthService;
  const app = createAuthRoutes(service);
  const intent = await app.request("/auth/intents", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ purpose: "login", provider: "google" }) });
  assert.equal(intent.status, 200);
  assert.deepEqual(calls[0], { method: "createIntent", args: ["login", "google"] });
  const proof = { intentId: "550e8400-e29b-41d4-a716-446655440000", proof: { idToken: "google-token" } };
  const login = await app.request("/auth/logins", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(proof) });
  assert.equal(login.status, 200);
  assert.deepEqual(calls[1], { method: "login", args: [proof.intentId, proof.proof] });
  const legacy = await app.request("/auth/logins/google", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(proof) });
  assert.equal(legacy.status, 404);
});

test("unsupported provider is rejected before service invocation", async () => {
  const service = { createIntent: async () => { throw new Error("should not be called"); } } as unknown as AuthService;
  const app = createAuthRoutes(service);
  const response = await app.request("/auth/intents", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ purpose: "login", provider: "github" }) });
  assert.equal(response.status, 400);
  const body = await response.json() as { errorCode: string };
  assert.equal(body.errorCode, "INVALID_INPUT");
});
