import { randomUUID } from "node:crypto";
import { sql, type Kysely, type Transaction } from "kysely";
import type { DB } from "../infrastructure/database/schema.js";
export type WorkRole = "proposal" | "creator";
export const workTable = (role: WorkRole) => role === "proposal" ? "proposal_runs" as const : "creation_runs" as const;
export class CreativeRepository {
  constructor(readonly db: Kysely<DB>) {}
  static async enqueueRecord(userId: string, recordId: string, version: number, trx: Transaction<DB>) {
    const now = new Date();
    await trx.insertInto("proposal_runs").values({ run_id: randomUUID(), user_id: userId, record_id: recordId, record_version: version, status: "queued", proposal_id: null, outcome: null, read_record_ids: JSON.stringify([]), agent_session_id: null, lease_token: null, lease_expires_at: null, attempts: 0, error_code: null, created_at: now, updated_at: now }).onConflict(oc => oc.columns(["user_id", "record_id", "record_version"]).doNothing()).execute();
  }
  async registerCreation(input: { userId: string; proposalId: string; resultProjectId: string; resolvedAt: Date }) {
    const now = new Date();
    await this.db.insertInto("creation_runs").values({ run_id: randomUUID(), user_id: input.userId, proposal_id: input.proposalId, project_id: input.resultProjectId, status: "queued", execution_plan: null, base_project_version: null, agent_session_id: null, lease_token: null, lease_expires_at: null, progress: { stage: "queued", completedImages: 0 }, published_project_version: null, attempts: 0, error_code: null, accepted_at: input.resolvedAt, created_at: now, updated_at: now }).onConflict(oc => oc.column("proposal_id").doNothing()).execute();
  }
  async claim(role: WorkRole) {
    return this.db.transaction().execute(async trx => {
      await sql`SELECT pg_advisory_xact_lock(78132761)`.execute(trx);
      const table = workTable(role), now = new Date();
      await trx.updateTable(table).set({ status: "queued", lease_token: null, lease_expires_at: null }).where("status", "=", "running").where("lease_expires_at", "<", now).execute();
      let q = trx.selectFrom(table).selectAll().where("status", "=", "queued");
      if (role === "creator") q = q.where(sql<boolean>`NOT EXISTS (SELECT 1 FROM creation_runs r WHERE r.project_id = creation_runs.project_id AND r.status = 'running') AND NOT EXISTS (SELECT 1 FROM creation_runs earlier WHERE earlier.project_id = creation_runs.project_id AND earlier.status = 'queued' AND (earlier.accepted_at, earlier.proposal_id) < (creation_runs.accepted_at, creation_runs.proposal_id))`);
      const row = await q.orderBy(role === "creator" ? "accepted_at" : "updated_at", "asc").orderBy("run_id").forUpdate().skipLocked().executeTakeFirst();
      if (!row) return null;
      return await trx.updateTable(table).set({ status: "running", lease_token: randomUUID(), lease_expires_at: new Date(now.getTime() + 90_000), attempts: sql<number>`attempts + 1`, updated_at: now }).where("run_id", "=", row.run_id).returningAll().executeTakeFirstOrThrow();
    });
  }
  async renew(role: WorkRole, id: string, token: string) {
    const row = await this.db.updateTable(workTable(role)).set({ lease_expires_at: new Date(Date.now() + 90_000) }).where("run_id", "=", id).where("status", "=", "running").where("lease_token", "=", token).where("lease_expires_at", ">", new Date()).returning("run_id").executeTakeFirst();
    return !!row;
  }
  async finish(role: WorkRole, id: string, token: string, status: "queued" | "completed" | "failed" | "cancelled", code?: string, outcome?: unknown) {
    await this.db.updateTable(workTable(role)).set({ status, lease_token: null, lease_expires_at: null, error_code: code ?? null, updated_at: new Date(), ...(code === "WAITING_FOR_RECORD" ? { attempts: sql<number>`greatest(attempts - 1, 0)` } : {}), ...(role === "proposal" && outcome ? { outcome } : {}) }).where("run_id", "=", id).where("status", "=", "running").where("lease_token", "=", token).execute();
  }
  async bind(role: WorkRole, id: string, token: string, sessionId: string, baseVersion?: number) {
    return this.db.updateTable(workTable(role)).set({ agent_session_id: sessionId, ...(role === "creator" ? { base_project_version: baseVersion ?? null } : {}) }).where("run_id", "=", id).where("status", "=", "running").where("lease_token", "=", token).where("lease_expires_at", ">", new Date()).returning("run_id").executeTakeFirst();
  }
  analysis(userId: string, id: string) { return this.db.selectFrom("proposal_runs").selectAll().where("user_id", "=", userId).where("run_id", "=", id).executeTakeFirst(); }
  creation(userId: string, id: string) { return this.db.selectFrom("creation_runs").selectAll().where("user_id", "=", userId).where("run_id", "=", id).executeTakeFirst(); }
  steps(id: string) { return this.db.selectFrom("creation_image_steps").selectAll().where("run_id", "=", id).orderBy("image_index").execute(); }
  latest(userId: string, projectId: string) { return this.db.selectFrom("creation_runs").selectAll().where("user_id", "=", userId).where("project_id", "=", projectId).orderBy("accepted_at", "desc").orderBy("proposal_id", "desc").executeTakeFirst(); }
}
