import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { sql } from "kysely";
import { createDatabase, runMigrations } from "../../infrastructure/database/database.js";
import type { JwtTokenService } from "../../infrastructure/auth/jwt-token-service.js";
import { AuthService } from "./auth-service.js";
import { IdentityProviderRegistry, type IdentityProvider, type IdentityProviderName, type VerifiedIdentity } from "./identity-provider.js";

const integration = process.env.TEST_DATABASE_URL ? test : test.skip;

integration("verified identity contacts persist through authentication, registration, login and rebinding without leaking in responses", async () => {
  if (!/test/i.test(new URL(process.env.TEST_DATABASE_URL!).pathname)) throw new Error("Dedicated test database required");
  const admin = createDatabase(process.env.TEST_DATABASE_URL!);
  const name = `identity_test_${randomUUID().replaceAll("-", "")}`;
  await sql.raw(`CREATE DATABASE ${name}`).execute(admin);
  const url = new URL(process.env.TEST_DATABASE_URL!); url.pathname = `/${name}`;
  const db = createDatabase(url.href);
  // Test-only verified results: real provider signature/nonce checks are tested separately.
  const verified: Record<IdentityProviderName, VerifiedIdentity> = {
    google: { provider: "google", subject: "google-owner", contactValue: "Owner.Name@example.com", displayHint: "O***@example.com" },
    apple: { provider: "apple", subject: "apple-owner", contactValue: "relay@privaterelay.appleid.com", displayHint: "r***@privaterelay.appleid.com" },
    phone: { provider: "phone", subject: "+8613800138000", displayHint: "+86 138****8000" },
  };
  const providers = new IdentityProviderRegistry(Object.keys(verified).map(key => {
    const name = key as IdentityProviderName;
    return { name, createChallenge: () => ({ public: {} }), verify: async () => verified[name] } satisfies IdentityProvider;
  }));
  const tokens = { issuePair: async () => ({ accessToken: "test-only", refreshToken: "test-only" }) } as unknown as JwtTokenService;
  const service = new AuthService(db, providers, tokens, { getOrLoad: async (_key, loader) => loader(), delete: () => {} });
  const intent = async (purpose: "authenticate" | "register" | "login" | "bind" | "reauth", provider: IdentityProviderName, userId?: string) =>
    (await service.createIntent(purpose, provider, userId)).intentId;
  const identity = (provider: IdentityProviderName, subject = verified[provider].subject) =>
    db.selectFrom("user_login_identities").selectAll().where("provider", "=", provider).where("provider_subject", "=", subject).executeTakeFirstOrThrow();
  try {
    await runMigrations(db);
    const owner = (await service.authenticate(await intent("authenticate", "google"), {})).user.userId;
    const original = await identity("google");
    assert.equal(original.contact_value, "Owner.Name@example.com");
    assert.equal(original.display_hint, "O***@example.com");
    verified.google = { ...verified.google, contactValue: "new@example.com", displayHint: "n***@example.com" };
    assert.equal((await service.authenticate(await intent("authenticate", "google"), {})).user.userId, owner);
    assert.equal((await identity("google")).identity_id, original.identity_id);
    assert.equal((await identity("google")).contact_value, "new@example.com");

    verified.google = { provider: "google", subject: "google-owner" };
    await service.login(await intent("login", "google"), {});
    verified.google.contactValue = null;
    await service.authenticate(await intent("authenticate", "google"), {});
    assert.equal((await identity("google")).contact_value, "new@example.com");
    assert.equal((await identity("google")).display_hint, "n***@example.com");

    // Explicit registration works without email; a later verified login backfills it.
    verified.google = { provider: "google", subject: "google-other" };
    const other = (await service.register(await intent("register", "google"), {})).user.userId;
    assert.equal((await identity("google")).contact_value, null);
    verified.google.contactValue = "new@example.com";
    await service.login(await intent("login", "google"), {});
    assert.equal((await identity("google")).contact_value, "new@example.com");
    assert.notEqual(other, owner, "Equal email addresses must not merge identities");
    verified.google = { provider: "google", subject: "google-owner" };

    const appleBinding = await service.bindIdentity(owner, await intent("bind", "apple", owner), {});
    assert.equal((await identity("apple")).contact_value, "relay@privaterelay.appleid.com");
    assert.ok(!("contactValue" in appleBinding));
    await service.unlinkIdentity(owner, appleBinding.identityId, { intentId: await intent("reauth", "google", owner), proof: {} });
    verified.apple = { provider: "apple", subject: "apple-owner" };
    const rebound = await service.bindIdentity(owner, await intent("bind", "apple", owner), {});
    assert.equal(rebound.displayHint, "r***@privaterelay.appleid.com");
    assert.equal((await identity("apple")).contact_value, "relay@privaterelay.appleid.com");
    assert.equal((await identity("apple")).revoked_at, null);
    await assert.rejects(service.bindIdentity(other, await intent("bind", "apple", other), {}));
    assert.equal((await identity("apple")).user_id, owner);

    await service.bindIdentity(owner, await intent("bind", "phone", owner), {});
    assert.equal((await identity("phone")).contact_value, "+8613800138000");
    assert.equal((await service.authenticate(await intent("authenticate", "phone"), {})).user.userId, owner);
    verified.phone = { provider: "phone", subject: "13800138000" };
    await assert.rejects(service.authenticate(await intent("authenticate", "phone"), {}), /international format/);
    assert.equal((await db.selectFrom("user_login_identities").selectAll().where("provider_subject", "=", "13800138000").execute()).length, 0);

    const me = await service.me(owner);
    assert.ok(me.identities.every(item => !("contactValue" in item) && !("contact_value" in item)));
    assert.ok(!JSON.stringify(me).includes("new@example.com"));
    assert.ok(!JSON.stringify(me).includes("+8613800138000"));

    const beforeRestart = await db.selectFrom("user_login_identities").selectAll().orderBy("identity_id").execute();
    // Schema upgrades are forward-only. A restart must retain migration bookkeeping,
    // not replay the historical baseline against already upgraded tables.
    await runMigrations(db); await runMigrations(db);
    assert.deepEqual(await db.selectFrom("user_login_identities").selectAll().orderBy("identity_id").execute(), beforeRestart);


  } finally {
    await db.destroy();
    await sql.raw(`DROP DATABASE ${name} WITH (FORCE)`).execute(admin);
    await admin.destroy();
  }
});
