import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import type { StoredAuthChallenge } from "../../../domain/auth/identity-provider.js";
import { AuthError } from "../../../domain/auth/errors.js";
import { AppleIdentityProvider } from "./apple-identity-provider.js";

const audience = "com.robinverse.fanto";
const hash = (value: string) => createHash("sha256").update(value).digest("base64url");

async function fixture() {
  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  const jwk = await exportJWK(publicKey);
  jwk.kid = "apple-test-key";
  jwk.alg = "RS256";
  const provider = new AppleIdentityProvider([audience], createLocalJWKSet({ keys: [jwk] }));
  const nonce = "server-nonce";
  const challenge: StoredAuthChallenge = {
    challenge_id: "550e8400-e29b-41d4-a716-446655440000",
    purpose: "authenticate",
    provider: "apple",
    user_id: null,
    target_hash: null,
    nonce_hash: hash(nonce),
    state_hash: null,
    verification_hash: null,
    context: {},
    expires_at: new Date(Date.now() + 60_000),
    consumed_at: null,
    created_at: new Date(),
  };
  const token = async (claims: Record<string, unknown> = {}, tokenAudience = audience) => new SignJWT({ nonce, email: "person@privaterelay.appleid.com", ...claims })
    .setProtectedHeader({ alg: "RS256", kid: jwk.kid })
    .setIssuer("https://appleid.apple.com")
    .setAudience(tokenAudience)
    .setSubject("apple-subject")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
  return { provider, challenge, token };
}

test("Apple provider verifies a signed token bound to the authentication nonce", async () => {
  const { provider, challenge, token } = await fixture();
  const identity = await provider.verify({ idToken: await token() }, challenge);
  assert.deepEqual(identity, { provider: "apple", subject: "apple-subject", displayHint: "p***@privaterelay.appleid.com" });
});

test("Apple provider rejects a token for another audience", async () => {
  const { provider, challenge, token } = await fixture();
  await assert.rejects(async () => provider.verify({ idToken: await token({}, "com.example.other") }, challenge), AuthError);
});

test("Apple provider rejects a token whose nonce does not match the intent", async () => {
  const { provider, challenge, token } = await fixture();
  await assert.rejects(async () => provider.verify({ idToken: await token({ nonce: "other-nonce" }) }, challenge), error => {
    assert.ok(error instanceof AuthError);
    assert.equal(error.message, "Identity provider nonce does not match authentication challenge");
    return true;
  });
});
