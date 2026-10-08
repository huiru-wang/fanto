import { sql, type Kysely } from "kysely";
import type { DB } from "../../infrastructure/database/schema.js";
import type { Cursor } from "./cursor.js";
import type { Project, Proposal, ProposalContent, ProposalStatus, ProposalType } from "./project.js";
export const projectEntity = (r: Omit<DB["projects"], "embedding">): Project => ({ projectId: r.project_id, userId: r.user_id, sessionId: r.session_id, title: r.title, summary: r.summary, coverMediaId: r.cover_media_id, content: r.content, goal: r.goal as Project["goal"], status: r.status, version: r.version, createdAt: r.created_at, updatedAt: r.updated_at });
const proposalContent = (value: unknown): ProposalContent => value as ProposalContent;
export const publicProposal = (proposal: Proposal) => ({
  proposalId: proposal.proposalId, type: proposal.type, targetProjectId: proposal.targetProjectId,
  title: proposal.title, status: proposal.status, resultProjectId: proposal.resultProjectId,
  createdAt: proposal.createdAt, updatedAt: proposal.updatedAt, resolvedAt: proposal.resolvedAt,
  content: { selectedIdeaId: proposal.content.selectedIdeaId,
    ideas: proposal.content.ideas.map(({id,title,idea,tags}) => ({id,title,idea,tags})) },
});
export const proposalEntity = (r: DB["proposals"]): Proposal => ({ proposalId: r.proposal_id, userId: r.user_id, sessionId: r.session_id, type: r.type, targetProjectId: r.target_project_id, title: r.title, proposedSummary: r.proposed_summary, content: proposalContent(r.content), status: r.status, resultProjectId: r.result_project_id, createdAt: r.created_at, updatedAt: r.updated_at, resolvedAt: r.resolved_at });
export class ProjectRepository {
  constructor(readonly db: Kysely<DB>) {}
  mediaReferences(userId: string) {
    return this.db.selectFrom("projects").select(["cover_media_id", "content"]).where("user_id", "=", userId).execute();
  }
  project(userId: string, id: string, lock = false) {
    const q = this.db.selectFrom("projects").selectAll().where("user_id", "=", userId).where("project_id", "=", id);
    return (lock ? q.forUpdate() : q).executeTakeFirst();
  }
  proposal(userId: string, id: string, lock = false) {
    const q = this.db.selectFrom("proposals").selectAll().where("user_id", "=", userId).where("proposal_id", "=", id);
    return (lock ? q.forUpdate() : q).executeTakeFirst();
  }
  projects(userId: string, status: "active" | "archived", cursor: Cursor | undefined, limit: number) {
    let q = this.db.selectFrom("projects").select(["project_id", "user_id", "session_id", "title", "summary", "cover_media_id", "goal", "status", "version", "created_at", "updated_at"]).where("user_id", "=", userId).where("status", "=", status);
    if (cursor) q = q.where(eb => eb.or([eb("updated_at", "<", new Date(cursor.time)), eb.and([eb("updated_at", "=", new Date(cursor.time)), eb("project_id", "<", cursor.id)])]));
    return q.orderBy("updated_at", "desc").orderBy("project_id", "desc").limit(limit).execute();
  }
  proposals(userId: string, f: { type?: ProposalType; status?: ProposalStatus; targetProjectId?: string }, cursor: Cursor | undefined, limit: number) {
    let q = this.db.selectFrom("proposals").selectAll().where("user_id", "=", userId);
    if (f.type) q = q.where("type", "=", f.type);
    if (f.status) q = q.where("status", "=", f.status);
    if (f.targetProjectId) q = q.where("target_project_id", "=", f.targetProjectId);
    if (cursor) q = q.where(eb => eb.or([eb("created_at", "<", new Date(cursor.time)), eb.and([eb("created_at", "=", new Date(cursor.time)), eb("proposal_id", "<", cursor.id)])]));
    return q.orderBy("created_at", "desc").orderBy("proposal_id", "desc").limit(limit).execute();
  }
  async search(userId: string, embedding: string) {
    const result = await sql<{ project_id: string; title: string; summary: string; version: number; similarity: number }>`
      SELECT project_id, title, summary, version, (1 - (embedding <=> ${embedding}::vector))::float8 AS similarity
      FROM projects WHERE user_id = ${userId} AND status = 'active' AND embedding IS NOT NULL
      ORDER BY embedding <=> ${embedding}::vector, project_id LIMIT 3
    `.execute(this.db);
    return result.rows.map(r => ({ projectId: r.project_id, title: r.title, summary: r.summary, version: r.version, similarity: Number(r.similarity) }));
  }
  links(userId: string, type: "project" | "proposal", id: string, cursor?: Cursor, limit?: number) {
    let q = this.db.selectFrom("record_links").selectAll().where("user_id", "=", userId).where("type", "=", type).where("outer_id", "=", id);
    if (cursor) q = q.where(eb => eb.or([eb("record_event_at", "<", new Date(cursor.time)), eb.and([eb("record_event_at", "=", new Date(cursor.time)), eb("record_id", "<", cursor.id)])]));
    q = q.orderBy("record_event_at", "desc").orderBy("record_id", "desc");
    return (limit === undefined ? q : q.limit(limit)).execute();
  }
  async count(userId: string, type: "project" | "proposal", id: string) {
    const r = await this.db.selectFrom("record_links").select(eb => eb.fn.countAll<string>().as("count")).where("user_id", "=", userId).where("type", "=", type).where("outer_id", "=", id).executeTakeFirstOrThrow();
    return Number(r.count);
  }
  async addLinks(userId: string, type: "project" | "proposal", id: string, records: Array<{ id: string; eventAt: string }>, now: Date) {
    if (!records.length) return 0;
    const rows = await this.db.insertInto("record_links").values(records.map(r => ({ user_id: userId, type, outer_id: id, record_id: r.id, record_event_at: new Date(r.eventAt), created_at: now }))).onConflict(oc => oc.columns(["user_id", "type", "outer_id", "record_id"]).doNothing()).returning("record_id").execute();
    return rows.length;
  }
  insertProject(row: DB["projects"]) { return this.db.insertInto("projects").values(row).returningAll().executeTakeFirstOrThrow(); }
  insertProposal(row: DB["proposals"]) { return this.db.insertInto("proposals").values(row).returningAll().executeTakeFirstOrThrow(); }
  updateProject(userId: string, id: string, patch: Partial<DB["projects"]>) {
    return this.db.updateTable("projects").set({ ...patch, version: sql<number>`version + 1`, updated_at: new Date() }).where("user_id", "=", userId).where("project_id", "=", id).returningAll().executeTakeFirstOrThrow();
  }
  resolveProposal(userId: string, id: string, status: "accepted" | "rejected", resultProjectId: string | null, now: Date, content?: ProposalContent) {
    return this.db.updateTable("proposals").set({ status, result_project_id: resultProjectId, resolved_at: now, updated_at: now, ...(content ? { content } : {}) }).where("user_id", "=", userId).where("proposal_id", "=", id).returningAll().executeTakeFirstOrThrow();
  }
  async cleanupRecord(userId: string, recordId: string) {
    const linked = await this.db.selectFrom("record_links").select("outer_id").where("user_id", "=", userId).where("record_id", "=", recordId).where("type", "=", "project").execute();
    const ids = [...new Set(linked.map(r => r.outer_id))].sort();
    if (ids.length) {
      await this.db.selectFrom("projects").select("project_id").where("user_id", "=", userId).where("project_id", "in", ids).orderBy("project_id").forUpdate().execute();
      await this.db.updateTable("projects").set({ version: sql<number>`version + 1`, updated_at: new Date() }).where("user_id", "=", userId).where("project_id", "in", ids).execute();
    }
    await this.db.deleteFrom("record_links").where("user_id", "=", userId).where("record_id", "=", recordId).execute();
  }
}
