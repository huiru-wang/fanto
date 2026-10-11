import { logError, logInfo, logSummary } from "../../infrastructure/logging/logger.js";
import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import type { DB } from "../../infrastructure/database/schema.js";
import type { RecordService } from "../records/index.js";
import type { MediaService } from "../media/index.js";
import type { ProjectService, ProposalService, CreateProposalInput } from "./index.js";
import type { ImageUnderstanding } from "../../infrastructure/clients/image-client.js";
import { ImageClientError, type ImageGenerationClient } from "../../infrastructure/clients/creative-image-client.js";
import { inspectProjectContent } from "./content.js";
import { CreativeError, projectManageSchema, type CreativeContext, type ImageInput, type ProjectManageInput } from "./creative-model.js";

export class CreativeService {
  constructor(readonly db: Kysely<DB>, private readonly records: RecordService,
    readonly projects: ProjectService, readonly proposals: ProposalService,
    readonly media: MediaService, private readonly image: ImageGenerationClient,
    private readonly activeUser: (userId: string) => Promise<unknown>,
    private readonly imageUnderstanding?: ImageUnderstanding) {}

  private async authorizedProject(context: CreativeContext) {
    if (context.recordId || context.recordVersion !== undefined || !context.projectId || !context.sessionId) throw new CreativeError("PROJECT_CONTEXT_REQUIRED");
    await this.activeUser(context.userId);
    const project = await this.projects.find(context.userId, context.projectId);
    if (!project || project.sessionId !== context.sessionId) throw new CreativeError("PROJECT_NOT_AUTHORIZED");
    if (project.status === "archived") throw new CreativeError("PROJECT_ARCHIVED");
    context.signal?.throwIfAborted();
    return project;
  }

  private async authorizedSourceRecord(context: CreativeContext) {
    if (context.projectId || !context.recordId || !Number.isSafeInteger(context.recordVersion) || (context.recordVersion ?? 0) < 1 || !context.sessionId) {
      throw new CreativeError("CREATIVE_AUTHORITY_REQUIRED");
    }
    await this.activeUser(context.userId);
    const record = await this.records.find(context.userId, context.recordId);
    if (!record || record.version !== context.recordVersion || record.status !== "processed") throw new CreativeError("SOURCE_RECORD_CHANGED");
    context.signal?.throwIfAborted();
    return record;
  }

  async context(context: CreativeContext) {
    if (context.recordId !== undefined || context.recordVersion !== undefined) {
      const record = await this.authorizedSourceRecord(context);
      const candidateProjects = await this.projects.candidates(context.userId, record.content);
      return {projectId:null,sourceRecord:{recordId:record.id,version:record.version,eventAt:record.eventAt,content:record.content},
        candidateProjects };
    }
    const project = await this.authorizedProject(context);
    const records = await this.projects.recordsPage(context.userId, project.projectId, { limit: 12 });
    if (records.kind === "error") throw new CreativeError(records.code);
    return { goal: project.goal, project, records: records.data };
  }

  async readRecords(context: CreativeContext, input: { recordIds?: string[]; query?: string }) {
    await this.activeUser(context.userId);
    if (context.recordId !== undefined || context.recordVersion !== undefined) await this.authorizedSourceRecord(context);
    else await this.authorizedProject(context);
    const ids = input.recordIds ?? (await this.records.search(context.userId, input.query ?? "", 3)).map(r => r.recordId);
    return this.records.findMany(context.userId, ids);
  }

  async readProject(context: CreativeContext, input: { action: "search" | "get"; projectId?: string; query?: string }) {
    if (input.action === "search") {
      if (context.recordId !== undefined || context.recordVersion !== undefined) await this.authorizedSourceRecord(context);
      else await this.authorizedProject(context);
      const result = await this.projects.search(context.userId, { query: input.query ?? "" });
      if (result.kind === "error") throw new CreativeError(result.code);
      return result.data;
    }
    const id = input.projectId ?? context.projectId;
    if (!id) throw new CreativeError("INVALID_INPUT");
    if (context.recordId !== undefined || context.recordVersion !== undefined) await this.authorizedSourceRecord(context);
    else {
      const bound = await this.authorizedProject(context);
      if (bound.projectId !== id) throw new CreativeError("PROJECT_NOT_AUTHORIZED");
    }
    const detail = await this.projects.detail(context.userId, id);
    if (detail.kind === "error") throw new CreativeError(detail.code);
    return detail.data;
  }

  async createProposal(context: CreativeContext, input: CreateProposalInput) {
    if (!context.recordId) throw new CreativeError("PROPOSAL_NOT_AUTHORIZED");
    if (!input.recordIds.includes(context.recordId)) throw new CreativeError("REFERENCE_RECORDS_UNAVAILABLE");
    await this.authorizedSourceRecord(context);
    const result = await this.proposals.create(context.userId, input, { sessionId: context.sessionId });
    if(result.kind === "ok") logInfo("proposal", "created", {userId:context.userId, recordId:context.recordId,
      sessionId:context.sessionId, proposalId:result.data.proposalId, decision:result.data.type,
      targetProjectId:result.data.targetProjectId, recordIds:[...new Set(input.recordIds)], reason:logSummary(result.data.content.reason)});
    if (result.kind === "error") throw new CreativeError(result.code);
    return { proposalId: result.data.proposalId, type: result.data.type, status: result.data.status, title: result.data.title };
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
    const fullContent = value.content ?? project.content;
    const inspected = inspectProjectContent(fullContent);
    if (inspected.kind === "error") throw new CreativeError(inspected.code);
    const cover = value.coverMediaId === undefined ? project.coverMediaId : value.coverMediaId;
    const refs = [...new Set([...inspected.data, ...(cover ? [cover] : [])])];
    if (refs.length) {
      const media = await this.media.findOwnedByIds(context.userId, refs);
      if (media.length !== refs.length) throw new CreativeError("MEDIA_NOT_READY");
      for (const asset of media) {
        if (asset.extData.createdBy === "image_generate" && asset.extData.requiresReview === true && !asset.extData.reviewedAt)
          throw new CreativeError("IMAGE_REVIEW_REQUIRED");
      }
    }
    const result = await this.projects.update(context.userId, project.projectId, expectedVersion, inputPatch, { completeFailedOnSave: true });
    if (result.kind === "error") throw new CreativeError(result.code);
    return result.data;
  }

  async reviewImage(context: CreativeContext, input: { mediaId: string; brief: string; referenceMediaIds?: string[] }) {
    const project = await this.authorizedProject(context);
    if (!this.imageUnderstanding?.review) throw new CreativeError("IMAGE_REVIEW_UNAVAILABLE");
    const { mediaId, brief } = input;
    const referenceMediaIds = input.referenceMediaIds ?? [];
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(mediaId) || !brief.trim() || brief.length > 2000 ||
        referenceMediaIds.length > 4 || new Set([mediaId, ...referenceMediaIds]).size !== referenceMediaIds.length + 1) throw new CreativeError("INVALID_INPUT");
    return this.media.withGenerationReferences(context.userId, [mediaId, ...referenceMediaIds], project.projectId, async ([url, ...referenceUrls]) => {
      const result = await this.imageUnderstanding!.review!({ imageUrl: url!, referenceUrls, brief, signal: context.signal });
      const row = await this.db.selectFrom("media_assets").select(["object_key", "ext_data"]).where("user_id", "=", context.userId).where("media_id", "=", mediaId).executeTakeFirst();
      if (!row) throw new CreativeError("SOURCE_MEDIA_UNAVAILABLE");
      const metadata = row.ext_data ? JSON.parse(row.ext_data) as Record<string, unknown> : {};
      if (metadata.requiresReview === true && metadata.createdBy === "image_generate") {
        if (!row.object_key.startsWith(`users/${context.userId}/project/${project.projectId}/`)) throw new CreativeError("PROJECT_NOT_AUTHORIZED");
        await this.db.updateTable("media_assets").set({ ext_data: JSON.stringify({...metadata, reviewedAt: new Date().toISOString()}), updated_at: new Date().toISOString() })
          .where("user_id", "=", context.userId).where("media_id", "=", mediaId).where("ext_data", "=", row.ext_data).execute();
      }
      return { mediaId, review: result.review, reviewKind: "visual_model_observation", verifiedByHuman: false };
    });
  }
  async generateImage(context: CreativeContext, input: ImageInput) {
    const project = await this.authorizedProject(context);
    const unique = [...new Set(input.referenceMediaIds)];
    if (!unique.length || unique.length !== input.referenceMediaIds.length) throw new CreativeError("INVALID_INPUT");
    const startedAt = Date.now();
    const details = {userId: context.userId, sessionId: context.sessionId, projectId: project.projectId,
      generationId: randomUUID(), referenceMediaIds: unique};
    let stage = "reference_urls";
    try {
      return await this.media.withGenerationReferences(context.userId, unique, project.projectId, async urls => {
        stage = "generate";
        const result = await this.image.generate({ prompt: input.prompt, referenceUrls: urls, aspectRatio: input.aspectRatio }, context.signal);
        stage = "download";
        const downloaded = await this.image.download(result.recovery, context.signal);
        stage = "save_media";
        const saved = await this.media.createGeneratedImage({
          userId: context.userId, mediaId: randomUUID(), projectId: project.projectId, ...downloaded,
        });
        logInfo("image-generation", "completed", {...details, mediaId: saved.mediaId, durationMs: Date.now()-startedAt});
        return { mediaId: saved.mediaId, mimeType: saved.mimeType, width: downloaded.width, height: downloaded.height };
      });
    } catch (error) {
      logError("image-generation", "failed", {...details, stage, durationMs: Date.now()-startedAt,
        error: logSummary(error), ...(error instanceof ImageClientError ? {errorCode: error.code, diagnostics: error.diagnostics} : {})});
      throw error;
    }
  }
}
