import { embedProjectText, type ProjectEmbeddingProvider } from "./summary-vector.js";
import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import type { DB } from "../../infrastructure/database/schema.js";
import type { RecordService } from "../records/index.js";
import type { MediaService } from "../media/index.js";
import { ProjectRepository, proposalEntity, publicProposal } from "./repository.js";
import { decodeCursor, page } from "./cursor.js";
import { acceptProposalSchema, createProposalSchema, paginationSchema, proposalListSchema, uuid } from "./validation.js";
import { failure, success, type AcceptProposalInput, type CreateProposalInput, type Pagination, type ProposalStatus, type ProposalType, type TransactionOptions } from "./project.js";

export class ProposalService {
  private constructor(private readonly db: Kysely<DB>, private readonly records: RecordService, private readonly media: MediaService, private readonly embeddings: ProjectEmbeddingProvider) {}
  static create(db: Kysely<DB>, records: RecordService, media: MediaService, embeddings: ProjectEmbeddingProvider) { return new ProposalService(db, records, media, embeddings); }
  async create(userId: string, input: CreateProposalInput, options: TransactionOptions & { sessionId?: string } = {}) {
    const parsed = createProposalSchema.safeParse(input);
    if (!parsed.success || (options.sessionId !== undefined && !uuid.safeParse(options.sessionId).success)) return failure("INVALID_INPUT");
    const value = parsed.data;
    const execute = async (trx: NonNullable<TransactionOptions["transaction"]>) => {
      const repo = new ProjectRepository(trx);
      const records = await this.records.findMany(userId, value.recordIds, { transaction: trx, lock: true });
      if (records.length !== value.recordIds.length) return failure("REFERENCE_RECORDS_UNAVAILABLE");
      if (value.type === "extend") {
        const target = await repo.project(userId, value.targetProjectId!, true);
        if (!target) return failure("NOT_FOUND");
        if (target.status === "archived") return failure("INVALID_STATE");
      }
      const now = new Date(), id = randomUUID();
      const content = value.type === "create"
        ? { reason: value.content.reason, opening: value.content.opening, ideas: value.content.ideas.map(idea => ({ ...idea, id: randomUUID() })), selectedIdeaId: null }
        : { reason: value.content.reason, opening: value.content.opening, change: value.content.change,
            ideas: [{ id: randomUUID(), title: value.content.change.title, idea: value.content.change.idea,
              tags: value.content.change.tags, goal: (await repo.project(userId, value.targetProjectId))!.goal }], selectedIdeaId: null };
      const row = await repo.insertProposal({ session_id: options.sessionId ?? null, proposal_id: id, user_id: userId, type: value.type, target_project_id: value.targetProjectId ?? null, title: value.title, proposed_summary: value.proposedSummary ?? null, content, status: "pending", result_project_id: null, created_at: now, updated_at: now, resolved_at: null });
      await repo.addLinks(userId, "proposal", id, records, now);
      return success(proposalEntity(row));
    };
    return options.transaction ? execute(options.transaction) : this.db.transaction().execute(execute);
  }

  async findBySession(userId: string, sessionId: string) {
    const row = await this.db.selectFrom("proposals").selectAll().where("user_id", "=", userId)
      .where("session_id", "=", sessionId).orderBy("created_at", "desc").executeTakeFirst();
    return row ? proposalEntity(row) : null;
  }
  async find(userId: string, id: string) {
    if (!uuid.safeParse(id).success) return null;
    const row = await new ProjectRepository(this.db).proposal(userId, id);
    return row ? proposalEntity(row) : null;
  }
  async detail(userId: string, id: string) {
    if (!uuid.safeParse(id).success) return failure("INVALID_INPUT");
    return this.db.transaction().setIsolationLevel("repeatable read").execute(async trx => {
      const repo = new ProjectRepository(trx), row = await repo.proposal(userId, id);
      return row ? success({ ...publicProposal(proposalEntity(row)), referenceRecordCount: await repo.count(userId, "proposal", id) }) : failure("NOT_FOUND");
    });
  }
  async list(userId: string, input: Pagination & { type?: ProposalType; status?: ProposalStatus; targetProjectId?: string }) {
    const parsed = proposalListSchema.safeParse(input);
    if (!parsed.success) return failure("INVALID_INPUT");
    const { limit, type, status, targetProjectId } = parsed.data;
    const scope = ["proposals", userId, type ?? null, status ?? null, targetProjectId ?? null], cursor = decodeCursor(input.cursor, scope);
    if (cursor === null) return failure("INVALID_CURSOR");
    const rows = await new ProjectRepository(this.db).proposals(userId, { type, status, targetProjectId }, cursor, limit + 1);
    const result = page(rows, limit, scope, r => ({ time: r.created_at.toISOString(), id: r.proposal_id }));
    return success({ ...result, data: result.data.map(row => publicProposal(proposalEntity(row))) });
  }
  async recordsPage(userId: string, id: string, input: Pagination) {
    if (!uuid.safeParse(id).success || !paginationSchema.safeParse(input).success) return failure("INVALID_INPUT");
    const scope = ["proposal-records", userId, id], cursor = decodeCursor(input.cursor, scope);
    if (cursor === null) return failure("INVALID_CURSOR");
    return this.db.transaction().setIsolationLevel("repeatable read").execute(async trx => {
      const repo = new ProjectRepository(trx);
      if (!await repo.proposal(userId, id)) return failure("NOT_FOUND");
      const rows = await repo.links(userId, "proposal", id, cursor, input.limit + 1);
      const result = page(rows, input.limit, scope, r => ({ time: r.record_event_at.toISOString(), id: r.record_id }));
      return success({ ...result, data: await this.records.findMany(userId, result.data.map(r => r.record_id), { transaction: trx }) });
    });
  }
  async accept(userId: string, id: string, input: AcceptProposalInput = {}) {
    const parsed = acceptProposalSchema.safeParse(input);
    if (!uuid.safeParse(id).success || !parsed.success) return failure("INVALID_INPUT");
    return this.db.transaction().execute(async trx => {
      const repo = new ProjectRepository(trx), row = await repo.proposal(userId, id, true);
      if (!row) return failure("NOT_FOUND");
      const current = proposalEntity(row);
      const selectedId = parsed.data.selectedIdeaId ?? (current.content.ideas.length === 1 ? current.content.ideas[0]?.id : undefined);
      if (!selectedId) return failure("INVALID_INPUT");
      const selected = current.content.ideas.find(idea => idea.id === selectedId);
      if (!selected) return failure("INVALID_INPUT");
      if (row.status === "accepted") {
        return selectedId === current.content.selectedIdeaId
          ? success({ projectId: row.result_project_id!, firstAccepted: false })
          : failure("INVALID_STATE");
      }
      if (row.status !== "pending") return failure("INVALID_STATE");
      const links = await repo.links(userId, "proposal", id);
      // Record -> Project lock order matches deletion.
      const records = await this.records.findMany(userId, links.map(r => r.record_id), { transaction: trx, lock: true });
      if (!records.length) return failure("REFERENCE_RECORDS_UNAVAILABLE");
      const now = new Date(), projectId = row.type === "create" ? randomUUID() : row.target_project_id!;
      if (row.type === "create") {
        const prefix = `创作目标：${selected.title}。${selected.idea}；素材背景：`;
        const summary = prefix.slice(0, 2000) + (row.proposed_summary ?? "").slice(0, Math.max(0, 2000 - prefix.length));
        let embedding: string;
        try { embedding = await embedProjectText(this.embeddings, summary); }
        catch { return failure("EMBEDDING_UNAVAILABLE"); }
        await repo.insertProject({ project_id: projectId, user_id: userId, embedding, session_id: null,
          title: selected.title, summary, goal: selected.goal, cover_media_id: null,
          content: "", status: "queued", version: 1, created_at: now, updated_at: now });
      } else {
        const target = await repo.project(userId, projectId, true);
        if (!target) return failure("NOT_FOUND");
        if (!["completed","failed"].includes(target.status)) return failure("INVALID_STATE");
      }
      const addedRecordCount = await repo.addLinks(userId, "project", projectId, records, now);
      if (row.type === "extend") await repo.updateProject(userId, projectId, { status: "queued" });
      const resolved = await repo.resolveProposal(userId, id, "accepted", projectId, now,
        { ...current.content, selectedIdeaId: selectedId });
      return success({ projectId, firstAccepted: true });
    });
  }
  async reject(userId: string, id: string) {
    if (!uuid.safeParse(id).success) return failure("INVALID_INPUT");
    return this.db.transaction().execute(async trx => {
      const repo = new ProjectRepository(trx), row = await repo.proposal(userId, id, true);
      if (!row) return failure("NOT_FOUND");
      if (row.status === "rejected") return success({ proposal: publicProposal(proposalEntity(row)) });
      if (row.status !== "pending") return failure("INVALID_STATE");
      return success({ proposal: publicProposal(proposalEntity(await repo.resolveProposal(userId, id, "rejected", null, new Date()))) });
    });
  }
}
