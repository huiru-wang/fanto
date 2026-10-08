import { randomUUID } from "node:crypto";
import { sql, type Kysely } from "kysely";
import type { DB } from "../infrastructure/database/schema.js";
import type { RecordService } from "../domain/records/index.js";
import type { MediaService } from "../domain/media/index.js";
import type { ProjectService, ProposalService, CreateProposalInput } from "../domain/projects/index.js";
import type { ImageGenerationClient } from "../infrastructure/clients/creative-image-client.js";
import { CreativeError, projectManageSchema, type CreativeContext, type ImageInput, type ProjectManageInput } from "./model.js";

export class CreativeService {
  constructor(readonly db: Kysely<DB>, private readonly records: RecordService,
    readonly projects: ProjectService, readonly proposals: ProposalService,
    readonly media: MediaService, private readonly image: ImageGenerationClient,
    private readonly activeUser: (userId: string) => Promise<unknown>) {}

  private async authorizedProject(context: CreativeContext) {
    if (!context.projectId || !context.sessionId) throw new CreativeError("PROJECT_CONTEXT_REQUIRED");
    await this.activeUser(context.userId);
    const project = await this.projects.find(context.userId, context.projectId);
    if (!project || project.sessionId !== context.sessionId) throw new CreativeError("PROJECT_NOT_AUTHORIZED");
    context.signal?.throwIfAborted();
    return project;
  }

  async context(context: CreativeContext) {
    if (context.creative?.role === "proposal") return { projectId: null, role: "proposal", recordIds: [context.creative.recordId] };
    const project = await this.authorizedProject(context);
    return { projectId: project.projectId };
  }

  async readRecords(context: CreativeContext, input: { recordIds?: string[]; query?: string }) {
    await this.activeUser(context.userId);
    if (context.creative?.role !== "proposal") await this.authorizedProject(context);
    const ids = input.recordIds ?? (await this.records.search(context.userId, input.query ?? "", 3)).map(r => r.recordId);
    return this.records.findMany(context.userId, ids);
  }

  async readProject(context: CreativeContext, input: { action: "search" | "get"; projectId?: string; query?: string }) {
    if (input.action === "search") {
      if (context.creative?.role !== "proposal") await this.authorizedProject(context);
      const result = await this.projects.search(context.userId, { query: input.query ?? "" });
      if (result.kind === "error") throw new CreativeError(result.code);
      return result.data;
    }
    const id = input.projectId ?? context.projectId;
    if (!id) throw new CreativeError("INVALID_INPUT");
    if (context.creative?.role !== "proposal") {
      const bound = await this.authorizedProject(context);
      if (bound.projectId !== id) throw new CreativeError("PROJECT_NOT_AUTHORIZED");
    }
    const detail = await this.projects.detail(context.userId, id);
    if (detail.kind === "error") throw new CreativeError(detail.code);
    return detail.data;
  }

  async createProposal(context: CreativeContext, input: CreateProposalInput) {
    if (context.creative?.role !== "proposal" || !context.sessionId) throw new CreativeError("PROPOSAL_NOT_AUTHORIZED");
    if (!input.recordIds.includes(context.creative.recordId)) throw new CreativeError("REFERENCE_RECORDS_UNAVAILABLE");
    const record = await this.records.find(context.userId, context.creative.recordId);
    if (!record || record.version !== context.creative.recordVersion || record.status !== "processed") throw new CreativeError("SOURCE_RECORD_CHANGED");
    const result = await this.proposals.create(context.userId, input, { sessionId: context.sessionId });
    if (result.kind === "error") throw new CreativeError(result.code);
    await this.markAnalyzed(context.userId, context.creative.recordId, context.creative.recordVersion);
    return { proposalId: result.data.proposalId, type: result.data.type, status: result.data.status, title: result.data.title };
  }

  async markAnalyzed(userId: string, recordId: string, version: number) {
    await sql`UPDATE records SET ext_data = jsonb_set(COALESCE(ext_data::jsonb, '{}'::jsonb),
      '{proposalAnalyzedVersion}', to_jsonb(${version}::int))::text
      WHERE user_id = ${userId} AND record_id = ${recordId} AND version = ${version}`.execute(this.db);
  }

  async pendingRecords(limit = 10) {
    const result = await sql<{ user_id: string; record_id: string; version: number }>`
      SELECT user_id, record_id, version FROM records
      WHERE status = 'processed' AND
        (COALESCE(ext_data::jsonb->>'proposalAnalyzedVersion', '') <> version::text)
      ORDER BY updated_at DESC LIMIT ${limit}`.execute(this.db);
    return result.rows;
  }

  async pendingProposals(cursor?: string) {
    const result = await this.proposals.scanAcceptedCreations({ limit: 100, ...(cursor ? { cursor } : {}) });
    if (result.kind === "error") throw new CreativeError(result.code);
    return result.data;
  }

  async projectManage(context: CreativeContext, input: ProjectManageInput) {
    const project = await this.authorizedProject(context);
    const validated = projectManageSchema.safeParse(input);
    if (!validated.success) throw new CreativeError("INVALID_INPUT");
    const value = validated.data;
    if (value.action === "update" && project.projectId !== value.projectId) throw new CreativeError("PROJECT_NOT_AUTHORIZED");
    // The Proposal acceptance flow has already created and bound the Project.
    // For the first publication, create initializes that same Project instead of allocating another.
    const expectedVersion = value.action === "update" ? value.expectedVersion : project.version;
    const patch = value.action === "update"
      ? {title:value.title,summary:value.summary,goal:value.goal,content:value.content,coverMediaId:value.coverMediaId}
      : {title:value.title,summary:value.summary,goal:value.goal,content:value.content,coverMediaId:value.coverMediaId};
    const inputPatch = Object.fromEntries(Object.entries(patch).filter(([,v])=>v!==undefined));
    const result = await this.projects.update(context.userId, project.projectId, expectedVersion, inputPatch);
    if (result.kind === "error") throw new CreativeError(result.code);
    return result.data;
  }

  async generateImage(context: CreativeContext, input: ImageInput) {
    const project = await this.authorizedProject(context);
    const unique = [...new Set(input.referenceMediaIds)];
    if (!unique.length || unique.length !== input.referenceMediaIds.length) throw new CreativeError("INVALID_INPUT");
    return this.media.withGenerationReferences(context.userId, unique, project.projectId, async urls => {
      const result = await this.image.generate({ prompt: input.prompt, referenceUrls: urls, aspectRatio: input.aspectRatio }, context.signal);
      const downloaded = await this.image.download(result.recovery, context.signal);
      const saved = await this.media.createGeneratedImage({
        userId: context.userId, mediaId: randomUUID(), projectId: project.projectId, ...downloaded,
      });
      return { mediaId: saved.mediaId, mimeType: saved.mimeType, width: downloaded.width, height: downloaded.height };
    });
  }
}
