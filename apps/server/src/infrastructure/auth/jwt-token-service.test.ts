import assert from "node:assert/strict";
import test from "node:test";
import { exportPKCS8, exportSPKI, generateKeyPair } from "jose";
import { JwtTokenService } from "./jwt-token-service.js";

test("JWT service issues 30 minute access and 30 day refresh tokens with strict audiences", async () => {
  const { privateKey, publicKey } = await generateKeyPair("EdDSA", { extractable: true });
  const privateKeyPem = await exportPKCS8(privateKey);
  const publicKeyPem = await exportSPKI(publicKey);
  const service = await JwtTokenService.create({
    privateKeyPem,
    publicKeys: { "test-kid": publicKeyPem },
    activeKid: "test-kid",
    issuer: "fanto-test",
    accessAudiences: ["fanto-api", "fanto-agent"],
    refreshAudience: "fanto-refresh",
    accessTtlSeconds: 30 * 60,
    refreshTtlSeconds: 30 * 24 * 60 * 60,
  });
  const userId = "550e8400-e29b-41d4-a716-446655440000";
  const pair = await service.issuePair(userId);

  assert.equal((await service.verifyAccess(pair.accessToken, "fanto-api")).userId, userId);
  assert.equal((await service.verifyAccess(pair.accessToken, "fanto-agent")).userId, userId);
  assert.equal((await service.verifyRefresh(pair.refreshToken)).userId, userId);
  await assert.rejects(() => service.verifyAccess(pair.refreshToken, "fanto-api"));
  await assert.rejects(() => service.verifyAccess(pair.accessToken, "some-other-audience"));

  const accessMs = new Date(pair.accessTokenExpiresAt).getTime() - Date.now();
  const refreshMs = new Date(pair.refreshTokenExpiresAt).getTime() - Date.now();
  assert.ok(accessMs > 29 * 60_000 && accessMs <= 30 * 60_000);
  assert.ok(refreshMs > 29 * 24 * 60 * 60_000 && refreshMs <= 30 * 24 * 60 * 60_000);
});
