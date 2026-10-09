import type { Kysely, Transaction } from "kysely";
import type { DB } from "../../infrastructure/database/schema.js";

export type SessionDb = Kysely<DB> | Transaction<DB>;

export function zeroUsage() {
  return {
    input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

export function addUsage(left: ReturnType<typeof zeroUsage>, right: ReturnType<typeof zeroUsage>): ReturnType<typeof zeroUsage> {
  const l = left as typeof left & { cacheWrite1h?: number; reasoning?: number };
  const r = right as typeof right & { cacheWrite1h?: number; reasoning?: number };
  return {
    input: l.input + r.input, output: l.output + r.output,
    cacheRead: l.cacheRead + r.cacheRead, cacheWrite: l.cacheWrite + r.cacheWrite,
    ...(l.cacheWrite1h === undefined && r.cacheWrite1h === undefined ? {} : { cacheWrite1h: (l.cacheWrite1h ?? 0) + (r.cacheWrite1h ?? 0) }),
    ...(l.reasoning === undefined && r.reasoning === undefined ? {} : { reasoning: (l.reasoning ?? 0) + (r.reasoning ?? 0) }),
    totalTokens: l.totalTokens + r.totalTokens,
    cost: {
      input: l.cost.input + r.cost.input, output: l.cost.output + r.cost.output,
      cacheRead: l.cost.cacheRead + r.cost.cacheRead, cacheWrite: l.cost.cacheWrite + r.cost.cacheWrite,
      total: l.cost.total + r.cost.total,
    },
  };
}
