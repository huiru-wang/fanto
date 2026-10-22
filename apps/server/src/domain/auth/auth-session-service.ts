import { createHash, randomBytes, randomUUID } from "node:crypto";
import { sql, type Kysely, type Transaction } from "kysely";
import type { DB, AuthSessionsTable } from "../../infrastructure/database/schema.js";
import { TtlCache } from "../../infrastructure/cache/ttl-cache.js";
import { AuthError } from "./errors.js";

export type SessionTransport = "web" | "native";
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const invalid = () => new AuthError(401, "UNAUTHENTICATED", "Session expired or invalid");
const day = 86_400_000;

type CachedSession = Pick<AuthSessionsTable, "session_id" | "user_id" | "client_type" | "idle_expires_at" | "absolute_expires_at">;

export class AuthSessionService {
  private readonly cache = new TtlCache<string, CachedSession>({ ttlMs: day, maxEntries: 20_000 });
  constructor(private readonly db: Kysely<DB>, private readonly idleMs = 7 * day, private readonly maxMs = 30 * day) {
    if (!Number.isFinite(idleMs) || !Number.isFinite(maxMs) || idleMs <= 0 || maxMs < idleMs) throw new Error("Invalid session TTL");
  }

  async create(trx: Transaction<DB>, userId: string, clientType: SessionTransport) {
    const sessionToken = randomBytes(32).toString("base64url");
    const timestamp = new Date();
    const absolute = new Date(timestamp.getTime() + this.maxMs);
    const idle = new Date(Math.min(timestamp.getTime() + this.idleMs, absolute.getTime()));
    await trx.insertInto("auth_sessions").values({
      session_id: randomUUID(), token_hash: hashToken(sessionToken), user_id: userId, client_type: clientType,
      created_at: timestamp, last_seen_at: timestamp, idle_expires_at: idle,
      absolute_expires_at: absolute, revoked_at: null,
    }).execute();
    return { sessionToken, idleExpiresAt: idle.toISOString(), absoluteExpiresAt: absolute.toISOString() };
  }

  async verify(token: string, expected: SessionTransport, assertActiveUser: (userId: string) => Promise<unknown>) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw invalid();
    const key = hashToken(token);
    let session = this.cache.get(key);
    if (!session) {
      // Missing cache must never turn a database outage into a successful authentication.
      const found = await this.db.selectFrom("auth_sessions").selectAll().where("token_hash", "=", key)
        .executeTakeFirst().catch(() => { throw new AuthError(503, "AUTH_UNAVAILABLE", "Authentication temporarily unavailable"); });
      if (!found || found.revoked_at !== null) throw invalid();
      if (found.client_type !== expected || found.idle_expires_at.getTime() <= Date.now() || found.absolute_expires_at.getTime() <= Date.now()) throw invalid();
      await assertActiveUser(found.user_id);
      const timestamp = new Date();
      const idle = new Date(Math.min(timestamp.getTime() + this.idleMs, found.absolute_expires_at.getTime()));
      await this.db.updateTable("auth_sessions").set({ last_seen_at: timestamp, idle_expires_at: idle })
        .where("session_id", "=", found.session_id).where("revoked_at", "is", null).execute()
        .catch(() => { throw new AuthError(503, "AUTH_UNAVAILABLE", "Authentication temporarily unavailable"); });
      session = { ...found, idle_expires_at: idle };
      this.cache.set(key, session);
    }
    if (session.client_type !== expected || session.idle_expires_at.getTime() <= Date.now() || session.absolute_expires_at.getTime() <= Date.now()) {
      this.cache.delete(key);
      throw invalid();
    }
    await assertActiveUser(session.user_id);
    return { sessionId: session.session_id, userId: session.user_id };
  }

  // Bounded idempotent cleanup: maintain the one Session table without a new queue or worker.
  async cleanupExpired(limit = 1_000) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) throw new Error("Invalid cleanup batch size");
    await sql`DELETE FROM auth_sessions WHERE session_id IN (
      SELECT session_id FROM auth_sessions
      WHERE revoked_at IS NOT NULL OR idle_expires_at <= now() OR absolute_expires_at <= now()
      ORDER BY created_at ASC LIMIT ${limit}
    )`.execute(this.db);
  }

  // Idempotent even for an already revoked or unknown token; failed DB operations must propagate.
  async revoke(token: string, expected: SessionTransport) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return;
    const key = hashToken(token);
    await this.db.updateTable("auth_sessions").set({ revoked_at: new Date() })
      .where("token_hash", "=", key).where("client_type", "=", expected).where("revoked_at", "is", null).execute();
    this.cache.delete(key);
  }
}
