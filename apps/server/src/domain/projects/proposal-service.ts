import { embedProjectText, type ProjectEmbeddingProvider } from "./summary-vector.js";
import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import type { DB } from "../../infrastructure/database/schema.js";
import type { RecordService } from "../records/index.js";
import type { MediaService } from "../media/index.js";
import { ProjectRepository, proposalEntity } from "./repository.js";
import { decodeCursor, page } from "./cursor.js";
import { createProposalSchema, paginationSchema, proposalListSchema, uuid } from "./validation.js";
import { failure, success, type CreateProposalInput, type Pagination, type ProposalStatus, type ProposalType, type TransactionOptions } from "./project.js";

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
        if (target.status !== "active") return failure("INVALID_STATE");
      }
      const now = new Date(), id = randomUUID();
      const row = await repo.insertProposal({ session_id: options.sessionId ?? null, proposal_id: id, user_id: userId, type: value.type, target_project_id: value.targetProjectId ?? null, title: value.title, proposed_summary: value.proposedSummary ?? null, content: { reason: value.content.reason, idea: value.content.idea, plan: value.content.plan, ...(value.content.creation ? { creation: value.content.creation } : {}) }, status: "pending", result_project_id: null, created_at: now, updated_at: now, resolved_at: null });
      await repo.addLinks(userId, "proposal", id, records, now);
      return success(proposalEntity(row));
    };
    return options.transaction ? execute(options.transaction) : this.db.transaction().execute(execute);
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
      return row ? success({ ...proposalEntity(row), referenceRecordCount: await repo.count(userId, "proposal", id) }) : failure("NOT_FOUND");
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
    return success({ ...result, data: result.data.map(proposalEntity) });
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
  async accept(userId: string, id: string) {
    if (!uuid.safeParse(id).success) return failure("INVALID_INPUT");
    return this.db.transaction().execute(async trx => {
      const repo = new ProjectRepository(trx), row = await repo.proposal(userId, id, true);
      if (!row) return failure("NOT_FOUND");
      if (row.status === "accepted") return success({ proposal: proposalEntity(row), resultProjectId: row.result_project_id!, addedRecordCount: 0 });
      if (row.status !== "pending") return failure("INVALID_STATE");
      const links = await repo.links(userId, "proposal", id);
      // Record -> Project lock order matches deletion. Missing Records are deliberately skipped.
      const records = await this.records.findMany(userId, links.map(r => r.record_id), { transaction: trx, lock: true });
      if (!records.length) return failure("REFERENCE_RECORDS_UNAVAILABLE");
      const now = new Date(), projectId = row.type === "create" ? randomUUID() : row.target_project_id!;
      if (row.type === "create") {
        let embedding: string;
        try { embedding = await embedProjectText(this.embeddings, row.proposed_summary!); }
        catch { return failure("EMBEDDING_UNAVAILABLE"); }
        await repo.insertProject({ project_id: projectId, user_id: userId, embedding, session_id: null, title: row.title, summary: row.proposed_summary!, cover_media_id: null, content: "", status: "active", version: 1, created_at: now, updated_at: now });
      } else {
        const target = await repo.project(userId, projectId, true);
        if (!target) return failure("NOT_FOUND");
        if (target.status !== "active") return failure("INVALID_STATE");
      }
      const addedRecordCount = await repo.addLinks(userId, "project", projectId, records, now);
      if (row.type === "extend" && addedRecordCount > 0) await repo.updateProject(userId, projectId, {});
      const resolved = await repo.resolveProposal(userId, id, "accepted", projectId, now);
      return success({ proposal: proposalEntity(resolved), resultProjectId: projectId, addedRecordCount });
    });
  }
  async reject(userId: string, id: string) {
    if (!uuid.safeParse(id).success) return failure("INVALID_INPUT");
    return this.db.transaction().execute(async trx => {
      const repo = new ProjectRepository(trx), row = await repo.proposal(userId, id, true);
      if (!row) return failure("NOT_FOUND");
      if (row.status === "rejected") return success({ proposal: proposalEntity(row) });
      if (row.status !== "pending") return failure("INVALID_STATE");
      return success({ proposal: proposalEntity(await repo.resolveProposal(userId, id, "rejected", null, new Date())) });
    });
  }
  /** Privileged recovery feed for server orchestration only; never expose as an HTTP or model tool. */
  async scanAcceptedCreations(input: Pagination) {
    if (!paginationSchema.safeParse(input).success) return failure("INVALID_INPUT");
    const scope = ["accepted-creations-v1"], cursor = decodeCursor(input.cursor, scope);
    if (cursor === null) return failure("INVALID_CURSOR");
    return this.db.transaction().setIsolationLevel("repeatable read").execute(async trx => {
      const repo = new ProjectRepository(trx), rows = await repo.scan(cursor, input.limit + 1);
      const result = page(rows, input.limit, scope, r => ({ time: r.resolved_at!.toISOString(), id: r.proposal_id }));
      const data = await Promise.all(result.data.map(async r => ({ userId: r.user_id, proposalId: r.proposal_id, resultProjectId: r.result_project_id!, resolvedAt: r.resolved_at!, creation: proposalEntity(r).content.creation!, referenceRecordIds: (await repo.links(r.user_id, "proposal", r.proposal_id)).map(link => link.record_id) })));
      return success({ ...result, data });
    });
  }
}
