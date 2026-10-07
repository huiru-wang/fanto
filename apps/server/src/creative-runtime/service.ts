import { createHash, randomUUID } from "node:crypto";
import { type Kysely, type Transaction } from "kysely";
import { z } from "zod";
import type { DB } from "../infrastructure/database/schema.js";
import type { RecordService } from "../domain/records/index.js";
import type { MediaService } from "../domain/media/index.js";
import type { CreateProposalInput, ProjectService, ProposalService } from "../domain/projects/index.js";
import { inspectProjectContent } from "../domain/projects/content.js";
import type { ImageGenerationClient } from "../infrastructure/clients/creative-image-client.js";
import { ImageClientError } from "../infrastructure/clients/creative-image-client.js";
import { CreativeRepository, workTable, type WorkRole } from "./repository.js";
import { CreativeError, fail, imageInputSchema, publishInputSchema, prepareInputSchema, type CreationExecutionPlan, type PrepareInput, type CreativeContext, type ImageInput, type GeneratedImage, type PublishInput } from "./model.js";

export class CreativeService {
  readonly repository: CreativeRepository;
  private recoveryCursor?: string;
  constructor(private readonly db: Kysely<DB>, private readonly records: RecordService, private readonly projects: ProjectService, private readonly proposals: ProposalService, private readonly media: MediaService, private readonly image: ImageGenerationClient, private readonly activeUser: (userId: string) => Promise<unknown>) { this.repository = new CreativeRepository(db); }
  static enqueueRecord = CreativeRepository.enqueueRecord;
  async reconcileAccepted() {
    const result = await this.proposals.scanAcceptedCreations({ cursor: this.recoveryCursor, limit: 100 });
    if (result.kind === "error") throw new CreativeError(result.code);
    for (const row of result.data.data) await this.repository.registerCreation(row);
    this.recoveryCursor = result.data.hasMore ? result.data.nextCursor! : undefined;
  }
  private async authorize(context: CreativeContext, role: WorkRole, database: Kysely<DB> = this.db, lock = false) {
    const a = context.creative;
    if (!a || a.role !== role || !context.sessionId) return fail("CREATIVE_AUTHORITY_REQUIRED");
    const id = a.role === "proposal" ? a.analysisRunId : a.creationRunId;
    let query = database.selectFrom(workTable(role)).select(["run_id", "user_id", "status", "agent_session_id", "lease_token", "lease_expires_at"]).where("user_id", "=", context.userId).where("run_id", "=", id);
    const row = await (lock ? query.forUpdate() : query).executeTakeFirst();
    if (!row || row.status !== "running" || row.agent_session_id !== context.sessionId || row.lease_token !== a.leaseToken || !row.lease_expires_at || row.lease_expires_at.getTime() <= Date.now()) return fail("CREATIVE_LEASE_LOST");
    await this.activeUser(context.userId);
    context.signal?.throwIfAborted();
    return id;
  }
  async context(context: CreativeContext) {
    const role = context.creative?.role;
    if (!role) return fail("CREATIVE_AUTHORITY_REQUIRED");
    const id = await this.authorize(context, role);
    if (role === "proposal") {
      const row = (await this.repository.analysis(context.userId, id))!;
      return { role, recordIds: [row.record_id], recordVersion: row.record_version, maxProposals: 1, supportedCreation: "根据已描述的原照片，保留人物身份与年龄，调整服饰、配饰和氛围，创作角色扮演写真及配文；最多 3 张图片", assessmentOrder: ["value", "creative_points", "project_relation", "proposal"] };
    }
    const row = (await this.repository.creation(context.userId, id))!;
    const proposal = await this.proposals.find(context.userId, row.proposal_id);
    if (!proposal || proposal.status !== "accepted" || proposal.resultProjectId !== row.project_id || !proposal.content.creation) return fail("CREATION_NOT_AUTHORIZED");
    return { role, creationRunId: id, projectId: row.project_id, proposalId: row.proposal_id, title: proposal.title, creation: proposal.content.creation, executionPlan: row.execution_plan, maxImages: 3, referenceRecordIds: await this.referenceRecordIds(context.userId, row.proposal_id), generatedImages: (await this.repository.steps(id)).filter(s => s.status === "saved").map(s => s.metadata), stage: row.progress };
  }
  private async referenceRecordIds(userId: string, proposalId: string) {
    const result = await this.proposals.recordsPage(userId, proposalId, { limit: 100 });
    if (result.kind === "error") return fail(result.code);
    return result.data.data.map(r => r.id);
  }
  async readRecords(context: CreativeContext, input: { recordIds?: string[]; query?: string }) {
    const role = context.creative?.role;
    if (!role) return fail("CREATIVE_AUTHORITY_REQUIRED");
    const id = await this.authorize(context, role);
    let ids = input.recordIds;
    if (role === "creator") {
      if (!ids || input.query) return fail("CREATIVE_RECORD_SCOPE");
      const run = (await this.repository.creation(context.userId, id))!;
      const allowed = await this.referenceRecordIds(context.userId, run.proposal_id);
      if (ids.some(r => !allowed.includes(r))) return fail("CREATIVE_RECORD_SCOPE");
    } else if (!ids) { ids = (await this.records.search(context.userId, input.query!, 3)).map(r => r.recordId); }
    const records = await this.records.findMany(context.userId, ids ?? []);
    if (role === "proposal") await this.db.transaction().execute(async trx => {
      await this.authorize(context, role, trx, true);
      const row = await trx.selectFrom("proposal_runs").select("read_record_ids").where("run_id", "=", id).executeTakeFirstOrThrow();
      await trx.updateTable("proposal_runs").set({ read_record_ids: JSON.stringify([...new Set([...(row.read_record_ids as string[]), ...records.map(r => r.id)])]) }).where("run_id", "=", id).execute();
    });
    return records;
  }
  async readProject(context: CreativeContext, input: { action: "search" | "get"; projectId?: string; query?: string }) {
    const valid = z.discriminatedUnion("action", [
      z.object({ action: z.literal("search"), query: z.string().trim().min(1).max(2000) }).strict(),
      z.object({ action: z.literal("get"), projectId: z.string().uuid() }).strict(),
    ]).safeParse(input);
    if (!valid.success) return fail("INVALID_INPUT");
    const role = context.creative?.role;
    if (!role) return fail("CREATIVE_AUTHORITY_REQUIRED");
    const id = await this.authorize(context, role);
    if (role === "creator") {
      const run = (await this.repository.creation(context.userId, id))!;
      if (valid.data.action === "search" || valid.data.projectId !== run.project_id) return fail("CREATIVE_PROJECT_SCOPE");
    }
    if (valid.data.action === "search") {
      const result = await this.projects.search(context.userId, { query: valid.data.query });
      if (result.kind === "error") return fail(result.code);
      return result.data;
    }
    const result = await this.projects.detail(context.userId, valid.data.projectId);
    if (result.kind === "error") return fail(result.code);
    const { content, ...project } = result.data;
    if (role === "creator") {
      const run = (await this.repository.creation(context.userId, id))!;
      const allowed = new Set(await this.referenceRecordIds(context.userId, run.proposal_id));
      project.referenceRecords = project.referenceRecords.filter(record => allowed.has(record.id));
    }
    return { ...project, contentPreview: content.slice(0, 12000), contentTruncated: content.length > 12000 };
  }
  async createProposal(context: CreativeContext, input: CreateProposalInput) {
    if (!input.content.creation) return fail("UNSUPPORTED_CREATIVE_INTENT");
    return this.db.transaction().execute(async trx => {
      const id = await this.authorize(context, "proposal", trx, true);
      const row = await trx.selectFrom("proposal_runs").selectAll().where("run_id", "=", id).executeTakeFirstOrThrow();
      const read = row.read_record_ids as string[];
      if (!input.recordIds.includes(row.record_id) || input.recordIds.some(id => !read.includes(id))) return fail("REFERENCE_RECORD_NOT_READ");
      const references = await this.records.findMany(context.userId, input.recordIds, { transaction: trx, lock: true });
      const trigger = references.find(record => record.id === row.record_id);
      if (trigger?.version !== row.record_version || trigger.status !== "processed") return fail("SOURCE_RECORD_CHANGED");
      const usable = references.flatMap(r => r.content.blocks).some(b => b.type === "image" && b.description?.trim());
      if (!usable) return fail("SOURCE_DESCRIPTION_UNAVAILABLE");
      const result = await this.proposals.create(context.userId, input, { transaction: trx, sessionId: context.sessionId });
      if (result.kind === "error") return fail(result.code);
      await trx.updateTable("proposal_runs").set({ status: "completed", proposal_id: result.data.proposalId, outcome: { decision: "proposal_created", proposalId: result.data.proposalId }, lease_token: null, lease_expires_at: null, error_code: null, updated_at: new Date() }).where("run_id", "=", id).execute();
      return { proposalId: result.data.proposalId, type: result.data.type, status: result.data.status, title: result.data.title };
    });
  }
  async validateCreation(userId: string, id: string, transaction?: Transaction<DB>) {
    await this.activeUser(userId);
    const run = await new CreativeRepository(transaction ?? this.db).creation(userId, id);
    if (!run) return fail("NOT_FOUND");
    const proposal = await this.proposals.find(userId, run.proposal_id), project = await this.projects.find(userId, run.project_id, { transaction });
    if (!proposal || proposal.status !== "accepted" || proposal.resultProjectId !== run.project_id || !proposal.content.creation) return fail("CREATION_NOT_AUTHORIZED");
    if (!project || project.status !== "active") return fail("PROJECT_ARCHIVED");
    const refs = await this.referenceRecordIds(userId, proposal.proposalId), records = await this.records.findMany(userId, refs, { transaction, lock: !!transaction });
    const images = records.flatMap(r => r.content.blocks.flatMap(b => b.type === "image" && b.description?.trim() ? [b] : []));
    const executionPlan = run.execution_plan as CreationExecutionPlan | null;
    const sourceMediaIds = executionPlan?.sourceMediaIds ?? images.map(image => image.mediaId);
    if (!sourceMediaIds.length || sourceMediaIds.some(id => !images.some(image => image.mediaId === id)) || (executionPlan && !sourceMediaIds.includes(executionPlan.subject.mediaId))) return fail("SOURCE_MEDIA_UNAVAILABLE");
    const assets = await this.media.findOwnedByIds(userId, sourceMediaIds, { transaction });
    if (assets.length !== sourceMediaIds.length || assets.some(a => a.status !== "ready" || a.mediaType !== "image")) return fail("SOURCE_MEDIA_UNAVAILABLE");
    const brief = { ...proposal.content.creation, sourceMediaIds, subject: executionPlan?.subject ?? { mediaId: "", description: "" }, imageCount: executionPlan?.imageCount ?? 0, composition: proposal.type === "create" ? "create" as const : "append" as const };
    return { run, proposal, project, brief, executionPlan, referenceRecordIds: refs };
  }
  async prepare(context: CreativeContext, raw: PrepareInput) {
    const parsed = prepareInputSchema.safeParse(raw); if (!parsed.success) return fail("INVALID_INPUT");
    const input = parsed.data;
    return this.db.transaction().execute(async trx => {
      const id = await this.authorize(context, "creator", trx, true);
      const { run, proposal, executionPlan, referenceRecordIds } = await this.validateCreation(context.userId, id, trx);
      const records = await this.records.findMany(context.userId, referenceRecordIds, { transaction: trx });
      const images = records.flatMap(r => r.content.blocks.flatMap(b => b.type === "image" && b.description?.trim() ? [b] : []));
      const subject = images.find(image => image.mediaId === input.subjectMediaId);
      if (!subject || input.sourceMediaIds.some(mediaId => !images.some(image => image.mediaId === mediaId))) return fail("CREATIVE_IMAGE_SCOPE");
      const plan: CreationExecutionPlan = { sourceMediaIds: [...input.sourceMediaIds].sort(), subject: { mediaId: subject.mediaId, description: subject.description! }, imageCount: input.imageCount, composition: proposal.type === "create" ? "create" : "append" };
      if (executionPlan) {
        if (JSON.stringify([...executionPlan.sourceMediaIds].sort()) !== JSON.stringify(plan.sourceMediaIds) || executionPlan.subject.mediaId !== plan.subject.mediaId || executionPlan.imageCount !== plan.imageCount || executionPlan.composition !== plan.composition) return fail("CREATION_PLAN_CONFLICT");
        return executionPlan;
      }
      if ((await new CreativeRepository(trx).steps(id)).length) return fail("CREATION_PLAN_REQUIRED");
      await trx.updateTable("creation_runs").set({ execution_plan: plan, progress: { stage: "generating", completedImages: 0, imageCount: plan.imageCount }, updated_at: new Date() }).where("run_id", "=", run.run_id).execute();
      return plan;
    });
  }
  async generateImage(context: CreativeContext, raw: ImageInput): Promise<GeneratedImage> {
    const parsed = imageInputSchema.safeParse(raw); if (!parsed.success) return fail("INVALID_INPUT");
    const input = parsed.data, id = await this.authorize(context, "creator");
    const { run, brief, executionPlan } = await this.validateCreation(context.userId, id);
    if (!executionPlan) return fail("CREATION_PLAN_REQUIRED");
    const saved = await this.repository.steps(id), allowed = [...brief.sourceMediaIds, ...saved.filter(s => s.status === "saved").map(s => s.media_id)];
    if (input.imageIndex > brief.imageCount || !input.referenceMediaIds.includes(brief.subject.mediaId) || input.referenceMediaIds.some(id => !allowed.includes(id)) || new Set(input.referenceMediaIds).size !== input.referenceMediaIds.length) return fail("CREATIVE_IMAGE_SCOPE");
    if (saved.some(s => ["requested", "unknown"].includes(s.status))) return fail("IMAGE_RESULT_UNKNOWN");
    if (saved.some(s => s.status === "failed")) return fail("IMAGE_GENERATION_FAILED");
    const fingerprint = createHash("sha256").update(JSON.stringify({ ...input, referenceMediaIds: [...input.referenceMediaIds].sort(), brief })).digest("hex");
    let step = saved.find(s => s.image_index === input.imageIndex);
    if (step && step.fingerprint !== fingerprint) return fail("IMAGE_SLOT_CONFLICT");
    if (step?.status === "saved") return step.metadata as GeneratedImage;
    if (step && ["requested", "unknown", "failed"].includes(step.status)) return fail(step.status === "failed" ? step.error_code ?? "IMAGE_GENERATION_FAILED" : "IMAGE_RESULT_UNKNOWN");
    if (!step) {
      const prompt = `${input.prompt}\n\nConfirmed objective: ${brief.objective}\nContext: ${brief.context ?? ""}\nOriginal subject: ${brief.subject.description}\nConfirmed constraints: ${(brief.constraints ?? []).join("; ")}\nSuccess criteria: ${(brief.successCriteria ?? []).join("; ")}\nRespect the original person's age and identity. No sexualized content. Do not place written text in the image.`;
      try {
        await this.media.withGenerationReferences(context.userId, input.referenceMediaIds, id, async urls => {
          await this.db.transaction().execute(async trx => {
            await this.authorize(context, "creator", trx, true);
            const now = new Date();
            const exists = await trx.selectFrom("creation_image_steps").select("run_id").where("run_id", "=", id).where("image_index", "=", input.imageIndex).executeTakeFirst();
            if (exists) return fail("IMAGE_SLOT_BUSY");
            await trx.insertInto("creation_image_steps").values({ run_id: id, image_index: input.imageIndex, fingerprint, status: "requested", media_id: randomUUID(), metadata: null, recovery_ciphertext: null, recovery_expires_at: null, error_code: null, created_at: now, updated_at: now }).execute();
            await trx.updateTable("creation_runs").set({ progress: { stage: "generating", completedImages: saved.filter(s => s.status === "saved").length, imageCount: brief.imageCount } }).where("run_id", "=", id).execute();
          });
          const response = await this.image.generate({ prompt, referenceUrls: urls, aspectRatio: input.aspectRatio }, context.signal);
          await this.db.transaction().execute(async trx => {
            await this.authorize(context, "creator", trx, true);
            await trx.updateTable("creation_image_steps").set({ status: "response", recovery_ciphertext: response.recovery, recovery_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000), updated_at: new Date() }).where("run_id", "=", id).where("image_index", "=", input.imageIndex).where("status", "=", "requested").execute();
          });
        });
      } catch (error) {
        const code = error instanceof ImageClientError || error instanceof CreativeError ? error.code : "SOURCE_MEDIA_UNAVAILABLE";
        if (code !== "IMAGE_SLOT_BUSY") await this.db.updateTable("creation_image_steps").set({ status: code === "IMAGE_RESULT_UNKNOWN" ? "unknown" : "failed", error_code: code, updated_at: new Date() }).where("run_id", "=", id).where("image_index", "=", input.imageIndex).where("status", "=", "requested").execute();
        return fail(code);
      }
      step = (await this.repository.steps(id)).find(s => s.image_index === input.imageIndex);
    }
    return this.saveStep(context, id, step!, run, brief);
  }
  private async saveStep(context: CreativeContext, id: string, step: Awaited<ReturnType<CreativeRepository["steps"]>>[number], run: { proposal_id: string; project_id: string }, brief: { imageCount: number }) {
    try {
      let output: GeneratedImage;
      const existing = (await this.media.findOwnedByIds(context.userId, [step.media_id]))[0];
      if (existing) {
        const capture = existing.extData.capture as { width?: number; height?: number } | undefined;
        if (existing.status !== "ready" || existing.mediaType !== "image" || existing.extData.creationRunId !== id || existing.extData.imageIndex !== step.image_index || !capture?.width || !capture.height) return fail("CREATIVE_IMAGE_SCOPE");
        output = { imageIndex: step.image_index, mediaId: existing.mediaId, mimeType: existing.mimeType, width: capture.width, height: capture.height };
      } else {
        if (!step.recovery_ciphertext || !step.recovery_expires_at || step.recovery_expires_at.getTime() <= Date.now()) return fail("IMAGE_RECOVERY_UNAVAILABLE");
        const image = await this.image.download(step.recovery_ciphertext, context.signal);
        const meta = await this.media.createGeneratedImage({ userId: context.userId, mediaId: step.media_id, creationRunId: id, proposalId: run.proposal_id, projectId: run.project_id, imageIndex: step.image_index, ...image });
        output = { imageIndex: step.image_index, mediaId: meta.mediaId, mimeType: meta.mimeType, width: image.width, height: image.height };
      }
      await this.db.transaction().execute(async trx => {
        await this.authorize(context, "creator", trx, true);
        await trx.updateTable("creation_image_steps").set({ status: "saved", metadata: output, recovery_ciphertext: null, recovery_expires_at: null, updated_at: new Date() }).where("run_id", "=", id).where("image_index", "=", step.image_index).execute();
        const count = (await new CreativeRepository(trx).steps(id)).filter(s => s.status === "saved").length;
        await trx.updateTable("creation_runs").set({ progress: { stage: count === brief.imageCount ? "writing" : "generating", completedImages: count, imageCount: brief.imageCount } }).where("run_id", "=", id).execute();
      });
      return output;
    } catch (error) { return fail(error instanceof CreativeError || error instanceof ImageClientError ? error.code : "IMAGE_SAVE_RETRYABLE"); }
  }
  async recoverImages(context: CreativeContext) {
    const id = await this.authorize(context, "creator");
    const { run, brief } = await this.validateCreation(context.userId, id);
    for (const step of await this.repository.steps(id)) {
      if (["requested", "unknown"].includes(step.status)) return fail("IMAGE_RESULT_UNKNOWN");
      if (step.status === "failed") return fail(step.error_code ?? "IMAGE_GENERATION_FAILED");
      if (step.status === "response") await this.saveStep(context, id, step, run, brief);
    }
  }
  async publish(context: CreativeContext, raw: PublishInput) {
    const parsed = publishInputSchema.safeParse(raw); if (!parsed.success) return fail("INVALID_INPUT");
    const input = parsed.data;
    const a = context.creative; if (a?.role !== "creator" || !context.sessionId) return fail("CREATIVE_AUTHORITY_REQUIRED");
    return this.db.transaction().execute(async trx => {
      const run = await trx.selectFrom("creation_runs").selectAll().where("run_id", "=", a.creationRunId).where("user_id", "=", context.userId).forUpdate().executeTakeFirst();
      if (!run || run.agent_session_id !== context.sessionId) return fail("CREATIVE_AUTHORITY_REQUIRED");
      if (run.status === "completed") return { projectId: run.project_id, version: run.published_project_version!, creationRunId: run.run_id, status: "completed" as const };
      await this.authorize(context, "creator", trx);
      const { brief, executionPlan } = await this.validateCreation(context.userId, run.run_id, trx);
      if (!executionPlan) return fail("CREATION_PLAN_REQUIRED");
      const slots = await new CreativeRepository(trx).steps(run.run_id), images = slots.filter(s => s.status === "saved");
      if (images.length !== brief.imageCount) return fail("CREATION_IMAGES_INCOMPLETE");
      const inspected = inspectProjectContent(input.markdown);
      if (inspected.kind === "error") return fail(inspected.code);
      const generated = images.map(s => s.media_id), allowed = [...brief.sourceMediaIds, ...generated];
      if (generated.some(id => !inspected.data.includes(id)) || inspected.data.some(id => !allowed.includes(id))) return fail("CREATIVE_IMAGE_SCOPE");
      const project = await this.projects.find(context.userId, run.project_id, { transaction: trx });
      if (!project || project.status !== "active") return fail("PROJECT_ARCHIVED");
      if (project.version !== input.expectedVersion) return fail("VERSION_CONFLICT");
      if (brief.composition === "create" && project.content.trim()) return fail("CONTENT_CONFLICT");
      if (input.coverMediaId && (brief.composition !== "create" || !generated.includes(input.coverMediaId))) return fail("CREATIVE_IMAGE_SCOPE");
      const content = brief.composition === "append" && project.content ? `${project.content}\n\n${input.markdown}` : input.markdown;
      const result = await this.projects.update(context.userId, run.project_id, input.expectedVersion, { content, summary: input.summary, ...(brief.composition === "create" ? { coverMediaId: input.coverMediaId ?? generated[0]! } : {}) }, { transaction: trx });
      if (result.kind === "error") return fail(result.code);
      await trx.updateTable("creation_runs").set({ status: "completed", published_project_version: result.data.version, progress: { stage: "completed", completedImages: images.length, imageCount: brief.imageCount }, lease_expires_at: null, error_code: null, updated_at: new Date() }).where("run_id", "=", run.run_id).execute();
      return { projectId: run.project_id, version: result.data.version, creationRunId: run.run_id, status: "completed" as const };
    });
  }
  async latest(userId: string, projectId: string) {
    if (!await this.projects.find(userId, projectId)) return null;
    const run = await this.repository.latest(userId, projectId);
    return { creation: run ? { creationRunId: run.run_id, proposalId: run.proposal_id, projectId: run.project_id, status: run.status, progress: run.progress, errorCode: run.error_code, publishedProjectVersion: run.published_project_version, updatedAt: run.updated_at } : null };
  }
  async analysisStatus(userId: string, recordId: string) {
    const record = await this.records.find(userId, recordId); if (!record) return null;
    const run = await this.db.selectFrom("proposal_runs").selectAll().where("user_id", "=", userId).where("record_id", "=", recordId).where("record_version", "=", record.version).executeTakeFirst();
    return { analysis: run ? { status: run.status, outcome: run.outcome, errorCode: run.error_code } : null };
  }
}
