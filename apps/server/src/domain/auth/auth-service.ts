import { randomUUID } from "node:crypto";
import type { Kysely, Transaction } from "kysely";
import type { DB } from "../../infrastructure/database/schema.js";
import { AuthSessionService, type SessionTransport } from "./auth-session-service.js";
import { AuthError } from "./errors.js";
import {ensureDefaultFanto} from "../fanto/default-fanto.js";
import type { ChallengePurpose, IdentityProviderName, StoredAuthChallenge, VerifiedIdentity } from "./identity-provider.js";
import { IdentityProviderRegistry } from "./identity-provider.js";

const challengeTtlMs = 10 * 60 * 1000;
const now = () => new Date();
type UserStatusCacheValue = { user_id: string; status: "active" | "disabled" } | null;
type UserStatusCache = {
  getOrLoad(key: string, loader: () => Promise<UserStatusCacheValue>): Promise<UserStatusCacheValue>;
  delete(key: string): void;
};

function uniqueViolation(cause: unknown): boolean {
  return !!cause && typeof cause === "object" && (cause as { code?: unknown }).code === "23505";
}

// Missing provider contact data must not erase a previously captured address.
function identityMetadata(identity: VerifiedIdentity) {
  return {
    contact_value: (identity.provider === "phone" ? identity.subject : identity.contactValue)?.trim() || undefined,
    display_hint: identity.displayHint?.trim() || undefined,
  };
}

export class AuthService {
  constructor(
    private readonly db: Kysely<DB>,
    private readonly providers: IdentityProviderRegistry,
    readonly sessions: AuthSessionService,
    private readonly userStatusCache: UserStatusCache,
  ) {}

  async createIntent(purpose: ChallengePurpose, providerName: IdentityProviderName, userId?: string, delivery: SessionTransport = "native") {
    const provider = this.providers.get(providerName);
    const providerChallenge = await provider.createChallenge();
    const challengeId = randomUUID();
    const createdAt = now();
    const expiresAt = new Date(createdAt.getTime() + challengeTtlMs);
    await this.db.insertInto("auth_challenges").values({
      challenge_id: challengeId,
      purpose,
      provider: provider.name,
      user_id: userId ?? null,
      target_hash: providerChallenge.stored?.targetHash ?? null,
      nonce_hash: providerChallenge.stored?.nonceHash ?? null,
      state_hash: providerChallenge.stored?.stateHash ?? null,
      verification_hash: providerChallenge.stored?.verificationHash ?? null,
      context: { ...(providerChallenge.stored?.context as Record<string, unknown> ?? {}), delivery },
      expires_at: expiresAt,
      consumed_at: null,
      created_at: createdAt,
    }).execute();
    return {
      intentId: challengeId,
      provider: provider.name,
      expiresAt: expiresAt.toISOString(),
      challenge: providerChallenge.public,
    };
  }

  async authenticate(intentId: string, proofInput: unknown, delivery: SessionTransport = "native") {
    const initial = await this.readChallenge(intentId, "authenticate");
    this.assertDelivery(initial, delivery);
    const verifiedIdentity = await this.verifyIdentity(proofInput, initial);
    const result = await this.db.transaction().execute(async trx => {
      const challenge = await this.lockChallenge(trx, intentId, "authenticate");
      this.assertDelivery(challenge, delivery);
      this.assertVerifiedMatchesChallenge(verifiedIdentity, challenge);
      const existing = await trx.selectFrom("user_login_identities")
        .select(["identity_id", "user_id", "revoked_at"])
        .where("provider", "=", verifiedIdentity.provider)
        .where("provider_subject", "=", verifiedIdentity.subject)
        .forUpdate()
        .executeTakeFirst();
      const timestamp = now();

      if (existing?.revoked_at === null) {
        await this.assertActiveUserIn(trx, existing.user_id);
        await trx.updateTable("user_login_identities")
          .set({ last_used_at: timestamp, ...identityMetadata(verifiedIdentity) })
          .where("identity_id", "=", existing.identity_id)
          .execute();
        await this.consumeChallenge(trx, intentId);
        return this.authResult(trx, existing.user_id, delivery);
      }

      if (existing) throw new AuthError(404, "IDENTITY_NOT_REGISTERED", "Identity is not registered");

      const id = randomUUID();
      await trx.insertInto("users").values({
        user_id: id,
        status: "active",
        created_at: timestamp,
        updated_at: timestamp,
        disabled_at: null,
      }).execute();
      await ensureDefaultFanto(trx,id);
      await trx.insertInto("user_login_identities").values({
        identity_id: randomUUID(),
        user_id: id,
        provider: verifiedIdentity.provider,
        provider_subject: verifiedIdentity.subject,
        ...identityMetadata(verifiedIdentity),
        verified_at: timestamp,
        last_used_at: timestamp,
        revoked_at: null,
        created_at: timestamp,
      }).execute();
      await this.consumeChallenge(trx, intentId);
      return this.authResult(trx, id, delivery);
    });
    return result;
  }

  private assertDelivery(challenge: StoredAuthChallenge, expected: SessionTransport) {
    if ((challenge.context as { delivery?: string } | null)?.delivery !== expected) {
      throw new AuthError(400, "CHALLENGE_INVALID", "Authentication channel does not match challenge");
    }
  }

  async bindIdentity(userId: string, intentId: string, proofInput: unknown) {
    await this.assertActiveUser(userId);
    const initial = await this.readChallenge(intentId, "bind", userId);
    const verifiedIdentity = await this.verifyIdentity(proofInput, initial);
    try {
      return await this.db.transaction().execute(async trx => {
        const challenge = await this.lockChallenge(trx, intentId, "bind", userId);
        this.assertVerifiedMatchesChallenge(verifiedIdentity, challenge);
        const existing = await trx.selectFrom("user_login_identities")
          .selectAll()
          .where("provider", "=", verifiedIdentity.provider)
          .where("provider_subject", "=", verifiedIdentity.subject)
          .forUpdate()
          .executeTakeFirst();
        if (existing && existing.user_id !== userId) {
          throw new AuthError(409, "IDENTITY_ALREADY_BOUND", "Identity belongs to another user");
        }
        const timestamp = now();
        let identityId: string;
        if (existing) {
          if (existing.revoked_at === null) throw new AuthError(409, "IDENTITY_ALREADY_BOUND", "Identity is already bound");
          identityId = existing.identity_id;
          await trx.updateTable("user_login_identities").set({
            revoked_at: null,
            verified_at: timestamp,
            last_used_at: timestamp,
            ...identityMetadata(verifiedIdentity),
          }).where("identity_id", "=", identityId).execute();
        } else {
          identityId = randomUUID();
          await trx.insertInto("user_login_identities").values({
            identity_id: identityId,
            user_id: userId,
            provider: verifiedIdentity.provider,
            provider_subject: verifiedIdentity.subject,
            ...identityMetadata(verifiedIdentity),
            verified_at: timestamp,
            last_used_at: timestamp,
            revoked_at: null,
            created_at: timestamp,
          }).execute();
        }
        await this.consumeChallenge(trx, intentId);
        return {
          identityId,
          provider: verifiedIdentity.provider,
          displayHint: verifiedIdentity.displayHint?.trim() || existing?.display_hint || null,
          verifiedAt: timestamp.toISOString(),
        };
      });
    } catch (cause) {
      if (uniqueViolation(cause)) throw new AuthError(409, "IDENTITY_ALREADY_BOUND", "Identity is already bound");
      throw cause;
    }
  }

  async unlinkIdentity(userId: string, identityId: string, reauth: { intentId: string; proof: unknown }) {
    await this.assertActiveUser(userId);
    const initial = await this.readChallenge(reauth.intentId, "reauth", userId);
    const verifiedIdentity = await this.verifyIdentity(reauth.proof, initial);
    await this.db.transaction().execute(async trx => {
      const challenge = await this.lockChallenge(trx, reauth.intentId, "reauth", userId);
      this.assertVerifiedMatchesChallenge(verifiedIdentity, challenge);
      await this.assertReauthIdentity(trx, userId, verifiedIdentity);
      const target = await trx.selectFrom("user_login_identities")
        .select(["identity_id", "user_id", "revoked_at"])
        .where("identity_id", "=", identityId)
        .forUpdate()
        .executeTakeFirst();
      if (!target || target.user_id !== userId || target.revoked_at !== null) {
        throw new AuthError(403, "IDENTITY_NOT_OWNED", "Identity is not owned by current user");
      }
      const active = await trx.selectFrom("user_login_identities")
        .select("identity_id")
        .where("user_id", "=", userId)
        .where("revoked_at", "is", null)
        .forUpdate()
        .execute();
      if (active.length <= 1) throw new AuthError(409, "LAST_IDENTITY_CANNOT_UNLINK", "Cannot unlink the last login identity");
      await trx.updateTable("user_login_identities").set({ revoked_at: now() }).where("identity_id", "=", identityId).execute();
      await this.consumeChallenge(trx, reauth.intentId);
    });
  }

  async me(userId: string) {
    const user = await this.assertActiveUser(userId);
    const identities = await this.db.selectFrom("user_login_identities")
      .select(["identity_id", "provider", "display_hint", "verified_at", "last_used_at", "created_at"])
      .where("user_id", "=", userId)
      .where("revoked_at", "is", null)
      .orderBy("created_at", "asc")
      .execute();
    return {
      userId: user.user_id,
      status: user.status,
      identities: identities.map(item => ({
        identityId: item.identity_id,
        provider: item.provider,
        displayHint: item.display_hint,
        verifiedAt: item.verified_at.toISOString(),
        lastUsedAt: item.last_used_at?.toISOString() ?? null,
        createdAt: item.created_at.toISOString(),
      })),
    };
  }

  async assertActiveUser(userId: string) {
    const user = await this.userStatusCache.getOrLoad(userId, async () =>
      await this.db.selectFrom("users")
        .select(["user_id", "status"])
        .where("user_id", "=", userId)
        .executeTakeFirst().catch(() => { throw new AuthError(503, "AUTH_UNAVAILABLE", "Authentication temporarily unavailable"); }) ?? null,
    );
    if (!user) throw new AuthError(401, "UNAUTHENTICATED", "User does not exist");
    if (user.status !== "active") throw new AuthError(403, "USER_DISABLED", "User is disabled");
    return user;
  }

  invalidateUserStatus(userId: string) {
    this.userStatusCache.delete(userId);
  }

  private async authResult(trx: Transaction<DB>, userId: string, delivery: SessionTransport) {
    const user = await this.assertActiveUserIn(trx, userId);
    const session = await this.sessions.create(trx, userId, delivery);
    return { user: { userId, status: user.status }, ...session };
  }

  private async verifyIdentity(proofInput: unknown, challenge: StoredAuthChallenge): Promise<VerifiedIdentity> {
    const identity = await this.providers.get(challenge.provider).verify(proofInput, challenge);
    if (identity.provider === "phone" && !/^\+[1-9]\d{1,14}$/.test(identity.subject)) {
      throw new AuthError(400, "INVALID_PROVIDER_PROOF", "Verified phone number must use international format");
    }
    return identity;
  }

  private assertVerifiedMatchesChallenge(identity: VerifiedIdentity, challenge: StoredAuthChallenge) {
    if (identity.provider !== challenge.provider) {
      throw new AuthError(400, "INVALID_PROVIDER_PROOF", "Identity provider proof does not match authentication challenge");
    }
  }

  private async assertReauthIdentity(trx: Transaction<DB>, userId: string, identity: VerifiedIdentity) {
    const reauthIdentity = await trx.selectFrom("user_login_identities")
      .select("identity_id")
      .where("user_id", "=", userId)
      .where("provider", "=", identity.provider)
      .where("provider_subject", "=", identity.subject)
      .where("revoked_at", "is", null)
      .executeTakeFirst();
    if (!reauthIdentity) throw new AuthError(400, "INVALID_PROVIDER_PROOF", "Reauthentication identity is not bound to this user");
  }

  private async readChallenge(id: string, purpose: ChallengePurpose, userId?: string): Promise<StoredAuthChallenge> {
    const row = await this.db.selectFrom("auth_challenges").selectAll().where("challenge_id", "=", id).executeTakeFirst();
    this.assertChallenge(row, purpose, userId);
    return row as StoredAuthChallenge;
  }

  private async lockChallenge(trx: Transaction<DB>, id: string, purpose: ChallengePurpose, userId?: string): Promise<StoredAuthChallenge> {
    const row = await trx.selectFrom("auth_challenges").selectAll().where("challenge_id", "=", id).forUpdate().executeTakeFirst();
    this.assertChallenge(row, purpose, userId);
    return row as StoredAuthChallenge;
  }

  private assertChallenge(
    row: { purpose: string; provider: string; user_id: string | null; expires_at: Date; consumed_at: Date | null } | undefined,
    purpose: ChallengePurpose,
    userId?: string,
  ) {
    if (!row || row.purpose !== purpose || row.consumed_at !== null || row.expires_at.getTime() <= Date.now()) {
      throw new AuthError(400, "CHALLENGE_INVALID", "Authentication challenge is invalid or expired");
    }
    this.providers.get(row.provider);
    if ((purpose === "bind" || purpose === "reauth") && row.user_id !== userId) {
      throw new AuthError(400, "CHALLENGE_INVALID", "Authentication challenge belongs to another user");
    }
  }

  private async consumeChallenge(trx: Transaction<DB>, id: string) {
    const updated = await trx.updateTable("auth_challenges")
      .set({ consumed_at: now() })
      .where("challenge_id", "=", id)
      .where("consumed_at", "is", null)
      .executeTakeFirst();
    if (Number(updated.numUpdatedRows) !== 1) throw new AuthError(400, "CHALLENGE_INVALID", "Authentication challenge is already consumed");
  }

  private async assertActiveUserIn(trx: Transaction<DB>, userId: string) {
    const user = await trx.selectFrom("users").select(["user_id", "status"]).where("user_id", "=", userId).executeTakeFirst();
    if (!user) throw new AuthError(401, "UNAUTHENTICATED", "User does not exist");
    if (user.status !== "active") throw new AuthError(403, "USER_DISABLED", "User is disabled");
    return user;
  }
}
