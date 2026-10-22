import assert from "node:assert/strict";
import test from "node:test";
import type { Kysely } from "kysely";
import type { DB } from "../../infrastructure/database/schema.js";
import { AuthSessionService } from "./auth-session-service.js";
import { AuthError } from "./errors.js";

const makeDb = () => {
  const rows: any[] = [];
  let queries = 0;
  const db = {
    insertInto: () => ({ values: (row: any) => ({ execute: async () => { rows.push(row); } }) }),
    selectFrom: () => ({ selectAll: () => ({ where: (_key: string, _eq: string, hash: string) => ({ executeTakeFirst: async () => { queries++; return rows.find(row => row.token_hash === hash); } }) }) }),
    updateTable: () => ({ set: (value: any) => {
      let matching: any[] = rows;
      const builder = { where: (key: string, _op: string, val: unknown) => {
        if (key === "token_hash" || key === "session_id" || key === "client_type") matching = matching.filter(row => row[key] === val);
        if (key === "revoked_at") matching = matching.filter(row => row[key] === null);
        return builder;
      }, execute: async () => { for (const row of matching) Object.assign(row, value); } };
      return builder;
    } }),
  };
  return { db: db as unknown as Kysely<DB>, rows, getQueries: () => queries };
};

test("Session uses opaque 32-byte randomness, stores only hash and caches verified identity", async () => {
  const { db, rows, getQueries } = makeDb();
  const service = new AuthSessionService(db);
  const issued = await service.create(db as never, "user-1", "native");
  assert.match(issued.sessionToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(rows[0].token_hash.length, 64);
  assert.notEqual(rows[0].token_hash, issued.sessionToken);
  assert.equal(rows[0].client_type, "native");
  const active = async () => ({ status: "active" });
  assert.equal((await service.verify(issued.sessionToken, "native", active)).userId, "user-1");
  assert.equal((await service.verify(issued.sessionToken, "native", active)).userId, "user-1");
  assert.equal(getQueries(), 1, "cached verification must not query Session DB again");
  await assert.rejects(service.verify(issued.sessionToken, "web", active), (e: unknown) => e instanceof AuthError && e.status === 401);
  await service.revoke(issued.sessionToken, "native");
  await assert.rejects(service.verify(issued.sessionToken, "native", active), (e: unknown) => e instanceof AuthError && e.status === 401);
});
