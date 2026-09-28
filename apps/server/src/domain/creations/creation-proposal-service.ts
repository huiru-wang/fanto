import { CreationProposalRepository } from "./proposal-repository.js";
import type { Kysely } from "kysely";
import type { DB } from "../../infrastructure/database/schema.js";
const valid = (value: string) => /^[0-9a-f-]{36}$/i.test(value);
export class CreationProposalService {
  constructor(private readonly repository: CreationProposalRepository) {}
  static create(db: Kysely<DB>) { return new CreationProposalService(new CreationProposalRepository(db)); }
  validId(id: string) { return valid(id); }
  private async present(userId: string, row: Awaited<ReturnType<CreationProposalRepository["find"]>>) { if (!row) return null; return { proposalId: row.proposal_id, operation: row.operation, creationId: row.creation_id, title: row.title, kind: row.kind_id ? { kindId: row.kind_id, name: row.kind_name ?? "unknown", title: row.kind_title ?? "未分类" } : null, summary: row.summary, content: row.content, status: row.status, sourceCount: await this.repository.sourceCount(userId, row.proposal_id), createdAt: row.created_at, updatedAt: row.updated_at }; }
  async listPending(userId: string) { return Promise.all((await this.repository.listPending(userId)).map(row => this.present(userId, row))); }
  async find(userId: string, id: string) { const proposal = await this.present(userId, await this.repository.find(userId, id)); return proposal ? { ...proposal, sources: await this.repository.sourceRecords(userId, id) } : null; }
  confirm(userId: string, id: string) { return this.repository.confirm(userId, id); }
  reject(userId: string, id: string) { return this.repository.reject(userId, id); }
}
