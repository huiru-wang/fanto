import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import type { StoredAuthChallenge } from "../../../domain/auth/identity-provider.js";
import { GoogleIdentityProvider } from "./google-identity-provider.js";

async function fixture() {
  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  const jwk = { ...await exportJWK(publicKey), kid: "test-key", alg: "RS256" };
  const provider = new GoogleIdentityProvider(["google-test-client"], createLocalJWKSet({ keys: [jwk] }));
  const challenge: StoredAuthChallenge = {
    challenge_id: "test-challenge", purpose: "authenticate", provider: "google", user_id: null,
    target_hash: null, state_hash: null, verification_hash: null, context: {},
    nonce_hash: createHash("sha256").update("test-nonce").digest("base64url"),
    created_at: new Date(), expires_at: new Date(Date.now() + 60_000), consumed_at: null,
  };
  const token = (claims: Record<string, unknown> = {}, audience = "google-test-client") => new SignJWT({ nonce: "test-nonce", email: "Owner.Name@example.com", ...claims })
    .setProtectedHeader({ alg: "RS256", kid: jwk.kid }).setIssuer("https://accounts.google.com")
    .setAudience(audience).setSubject("stable-google-sub").setIssuedAt().setExpirationTime("5m").sign(privateKey);
  return { provider, challenge, token };
}

test("Google verified email is retained separately from stable subject and masked hint", async () => {
  const { provider, challenge, token } = await fixture();
  assert.deepEqual(await provider.verify({ idToken: await token() }, challenge), {
    provider: "google", subject: "stable-google-sub", contactValue: "Owner.Name@example.com", displayHint: "O***@example.com",
  });
  const missing = await provider.verify({ idToken: await token({ email: undefined }) }, challenge);
  assert.equal(missing.contactValue, null);
  assert.equal(missing.displayHint, null);
});

test("Google rejects contact data from a token with a mismatched nonce or audience", async () => {
  const { provider, challenge, token } = await fixture();
  await assert.rejects(provider.verify({ idToken: await token({ nonce: "wrong" }) }, challenge));
  await assert.rejects(provider.verify({ idToken: await token({}, "wrong") }, challenge));
});
