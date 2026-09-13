import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import type { DB } from "../../infrastructure/schema.js";
import { nowIso } from "../../infrastructure/time.js";

export type Creation = { id: string; userId: string; title: string; type: "thread"; sessionId: string; summary: unknown; content: string; source: unknown; status: "active" | "completed" | "archived"; version: number; createdAt: string; updatedAt: string };
export type ProposalStatus = "generating" | "pending_confirmation" | "confirmed" | "rejected" | "superseded" | "failed";
export type CreationProposal = { id: string; userId: string; creationId: string | null; baseCreationVersion: number | null; operation: "create" | "update"; sessionId: string; title: string | null; type: "thread" | null; summary: unknown | null; content: string | null; source: unknown | null; status: ProposalStatus; failureCode: string | null; failureMessage: string | null; createdAt: string; updatedAt: string };

const parse = (value: string | null) => value ? JSON.parse(value) : null;
const creation = (row: any): Creation => ({ id: row.creation_id, userId: row.user_id, title: row.title, type: row.type, sessionId: row.session_id, summary: parse(row.summary), content: row.content, source: parse(row.source), status: row.status, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at });
const proposal = (row: any): CreationProposal => ({ id: row.proposal_id, userId: row.user_id, creationId: row.creation_id, baseCreationVersion: row.base_creation_version, operation: row.operation, sessionId: row.session_id, title: row.title, type: row.type, summary: parse(row.summary), content: row.content, source: parse(row.source), status: row.status, failureCode: row.failure_code, failureMessage: row.failure_message, createdAt: row.created_at, updatedAt: row.updated_at });

export class SqliteCreationRepository {
  constructor(private readonly db: Kysely<DB>) {}

  async activeByUser(userId: string) { return (await this.db.selectFrom("creations").selectAll().where("user_id", "=", userId).where("status", "=", "active").execute()).map(creation); }
  async listProposals(userId: string, status?: ProposalStatus) { let q = this.db.selectFrom("creation_proposals").selectAll().where("user_id", "=", userId); if (status) q = q.where("status", "=", status); return (await q.orderBy("created_at", "desc").orderBy("proposal_id", "desc").execute()).map(proposal); }
  async activeUpdateCreationIds(userId: string) { const rows = await this.db.selectFrom("creation_proposals").select("creation_id").where("user_id", "=", userId).where("operation", "=", "update").where("status", "in", ["generating", "pending_confirmation"]).execute(); return new Set(rows.flatMap(row => row.creation_id ? [row.creation_id] : [])); }
  async findProposal(userId: string, proposalId: string) { const row = await this.db.selectFrom("creation_proposals").selectAll().where("user_id", "=", userId).where("proposal_id", "=", proposalId).executeTakeFirst(); return row ? proposal(row) : null; }
  async findCreation(userId: string, creationId: string) { const row = await this.db.selectFrom("creations").selectAll().where("user_id", "=", userId).where("creation_id", "=", creationId).executeTakeFirst(); return row ? creation(row) : null; }

  async startProposal(input: { userId: string; operation: "create" | "update"; creationId?: string; baseCreationVersion?: number; sessionId: string }) {
    const now = nowIso(); const proposalId = randomUUID();
    await this.db.insertInto("creation_proposals").values({ proposal_id: proposalId, user_id: input.userId, creation_id: input.creationId ?? null, base_creation_version: input.baseCreationVersion ?? null, operation: input.operation, session_id: input.sessionId, title: null, type: null, summary: null, content: null, source: null, status: "generating", failure_code: null, failure_message: null, created_at: now, updated_at: now }).execute();
    return proposalId;
  }

  async completeProposal(userId: string, proposalId: string, input: { title: string; summary: unknown; content: string; source: unknown }) {
    await this.db.updateTable("creation_proposals").set({ title: input.title, type: "thread", summary: JSON.stringify(input.summary), content: input.content, source: JSON.stringify(input.source), status: "pending_confirmation", updated_at: nowIso() }).where("user_id", "=", userId).where("proposal_id", "=", proposalId).where("status", "=", "generating").execute();
    return this.findProposal(userId, proposalId);
  }

  async failProposal(userId: string, proposalId: string, code: string, message: string) {
    await this.db.updateTable("creation_proposals").set({ status: "failed", failure_code: code, failure_message: message, updated_at: nowIso() }).where("user_id", "=", userId).where("proposal_id", "=", proposalId).where("status", "=", "generating").execute();
  }

  async reject(userId: string, proposalId: string) { const result = await this.db.updateTable("creation_proposals").set({ status: "rejected", updated_at: nowIso() }).where("user_id", "=", userId).where("proposal_id", "=", proposalId).where("status", "=", "pending_confirmation").executeTakeFirst(); return Number(result.numUpdatedRows) === 1; }

  async confirm(userId: string, proposalId: string): Promise<{ kind: "not_found" | "invalid_state" } | { kind: "conflict"; creationId: string; expectedVersion: number; actualVersion: number | null } | { kind: "confirmed"; proposal: CreationProposal; creation: Creation }> {
    return this.db.transaction().execute(async trx => {
      const row = await trx.selectFrom("creation_proposals").selectAll().where("user_id", "=", userId).where("proposal_id", "=", proposalId).executeTakeFirst();
      if (!row) return { kind: "not_found" } as const;
      const item = proposal(row);
      if (item.status !== "pending_confirmation" || !item.title || !item.type || !item.content || !item.summary || !item.source) return { kind: "invalid_state" } as const;
      const now = nowIso();
      if (item.operation === "create") {
        const creationId = randomUUID();
        await trx.insertInto("creations").values({ creation_id: creationId, user_id: userId, title: item.title, type: item.type, session_id: item.sessionId, summary: JSON.stringify(item.summary), content: item.content, source: JSON.stringify(item.source), status: "active", version: 1, created_at: now, updated_at: now }).execute();
        await trx.updateTable("creation_proposals").set({ status: "confirmed", updated_at: now }).where("proposal_id", "=", proposalId).execute();
        const saved = await trx.selectFrom("creations").selectAll().where("creation_id", "=", creationId).executeTakeFirstOrThrow();
        return { kind: "confirmed", proposal: { ...item, status: "confirmed" }, creation: creation(saved) } as const;
      }
      const target = await trx.selectFrom("creations").selectAll().where("user_id", "=", userId).where("creation_id", "=", item.creationId!).executeTakeFirst();
      if (!target || target.version !== item.baseCreationVersion) { await trx.updateTable("creation_proposals").set({ status: "superseded", updated_at: now }).where("proposal_id", "=", proposalId).execute(); return { kind: "conflict", creationId: item.creationId!, expectedVersion: item.baseCreationVersion!, actualVersion: target?.version ?? null } as const; }
      await trx.updateTable("creations").set({ title: item.title, summary: JSON.stringify(item.summary), content: item.content, source: JSON.stringify(item.source), version: target.version + 1, updated_at: now }).where("creation_id", "=", target.creation_id).execute();
      await trx.updateTable("creation_proposals").set({ status: "confirmed", updated_at: now }).where("proposal_id", "=", proposalId).execute();
      await trx.updateTable("creation_proposals").set({ status: "superseded", updated_at: now }).where("creation_id", "=", target.creation_id).where("operation", "=", "update").where("status", "in", ["generating", "pending_confirmation"]).where("proposal_id", "!=", proposalId).execute();
      const saved = await trx.selectFrom("creations").selectAll().where("creation_id", "=", target.creation_id).executeTakeFirstOrThrow();
      return { kind: "confirmed", proposal: { ...item, status: "confirmed" }, creation: creation(saved) } as const;
    });
  }
}
