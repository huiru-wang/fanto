import { AdminRepository, EMPTY_USAGE } from "./admin-repository.js";

export class AdminNotFound extends Error {}
export class AdminInvalidCursor extends Error {}
const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
function decode(cursor: string | undefined, kind: "user" | "session") {
  if (!cursor) return undefined;
  try {
    if (cursor.length > 512 || !/^[\w-]+$/.test(cursor)) throw new Error();
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    const value = parsed as Record<string, unknown>;
    if (kind === "user" && typeof value.userId === "string" && value.userId.length > 0 && value.userId.length <= 128 &&
      typeof value.createdAt === "string" && !Number.isNaN(Date.parse(value.createdAt)) && new Date(value.createdAt).toISOString() === value.createdAt)
      return { createdAt: value.createdAt, userId: value.userId };
    if (kind === "session" && typeof value.sessionId === "string" && value.sessionId.length > 0 && value.sessionId.length <= 128 &&
      typeof value.updatedAt === "number" && Number.isSafeInteger(value.updatedAt) && value.updatedAt >= 0)
      return { sessionId: value.sessionId, updatedAt: value.updatedAt };
  } catch { /* invalid */ }
  throw new AdminInvalidCursor("Invalid pagination cursor");
}

export class AdminService {
  constructor(private readonly repository: AdminRepository) {}

  async users(args: { limit: number; cursor?: string; query?: string; status?: "active" | "disabled" }) {
    const page = await this.repository.listUsers({ ...args, before: decode(args.cursor, "user") as { createdAt: string; userId: string } | undefined });
    const totals = await this.repository.usageForUsers(page.data.map(user => user.userId));
    const data = page.data.map(user => ({ ...user, sessionCount: totals.get(user.userId)?.sessionCount ?? 0,
      usage: totals.get(user.userId)?.usage ?? { ...EMPTY_USAGE } }));
    const tail = data.at(-1);
    return { data, hasMore: page.hasMore, nextCursor: page.hasMore && tail
      ? encode({ createdAt: tail.createdAt, userId: tail.userId }) : null };
  }

  async user(userId: string) {
    const user = await this.repository.getUser(userId);
    if (!user) throw new AdminNotFound("User not found");
    return user;
  }

  async userUsage(userId: string) {
    await this.user(userId);
    const result = await this.repository.usageForUsers([userId]);
    return { userId, sessionCount: result.get(userId)?.sessionCount ?? 0,
      usage: result.get(userId)?.usage ?? { ...EMPTY_USAGE } };
  }

  async sessions(userId: string, args: { limit: number; cursor?: string; agentId?: string }) {
    await this.user(userId);
    const page = await this.repository.listSessions(userId, { ...args, before: decode(args.cursor, "session") as { updatedAt: number; sessionId: string } | undefined });
    const totals = await this.repository.usageForSessions(page.data.map(session => session.sessionId));
    const data = page.data.map(session => ({ ...session, usage: totals.get(session.sessionId) ?? { ...EMPTY_USAGE } }));
    const tail = data.at(-1);
    return { data, hasMore: page.hasMore, nextCursor: page.hasMore && tail
      ? encode({ updatedAt: Date.parse(tail.updatedAt), sessionId: tail.sessionId }) : null };
  }

  async sessionUsage(sessionId: string) {
    const session = await this.repository.getSession(sessionId);
    if (!session) throw new AdminNotFound("Session not found");
    const totals = await this.repository.usageForSessions([sessionId]);
    return { session, usage: totals.get(sessionId) ?? { ...EMPTY_USAGE }, models: await this.repository.sessionModels(sessionId) };
  }
}
