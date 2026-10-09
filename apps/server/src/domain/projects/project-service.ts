import { embedProjectText, type ProjectEmbeddingProvider } from "./summary-vector.js";
import { z } from "zod";
import type { Kysely } from "kysely";
import type { DB } from "../../infrastructure/database/schema.js";
import type { RecordService } from "../records/index.js";
import type { MediaService } from "../media/index.js";
import { ProjectRepository, projectEntity } from "./repository.js";
import { decodeCursor, page } from "./cursor.js";
import { inspectProjectContent } from "./content.js";
import { paginationSchema, patchSchema, projectListSchema, uuid, versionSchema } from "./validation.js";
import { failure, success, type Pagination, type ProjectPatch, type ProjectStatus, type TransactionOptions } from "./project.js";

/** Retrieval features are generic lexical signals, never Proposal decision rules. */
function discoveryText(content: unknown): string {
  if (typeof content === "string") return content.slice(0, 2400);
  if (!content || typeof content !== "object") return "";
  const row=content as {text?:unknown;blocks?:unknown};
  const parts=[typeof row.text==="string"?row.text:""];
  if(Array.isArray(row.blocks)) for (const block of row.blocks) {
    if(!block || typeof block!=="object")continue;
    const data=block as {description?:unknown;transcription?:unknown};
    if(typeof data.description==="string")parts.push(data.description);
    if(typeof data.transcription==="string")parts.push(data.transcription);
  }
  return parts.join("\n").slice(0, 2400);
}
function grams(value:string):Set<string>{
  const cleaned=value.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu,"");
  const out=new Set<string>();
  for(let i=0;i<cleaned.length-1;i++)out.add(cleaned.slice(i,i+2));
  return out;
}
function lexicalOverlap(a:Set<string>, b:Set<string>):number{
  if(!a.size || !b.size)return 0;
  let common=0;for(const gram of b)if(a.has(gram))common++;
  return common/Math.sqrt(a.size*b.size);
}

export class ProjectService {
  private constructor(private readonly db: Kysely<DB>, private readonly records: RecordService, private readonly media: MediaService, private readonly embeddings: ProjectEmbeddingProvider) {}
  /** Internal Record deletion hook; caller already holds the Record lock. */
  static async removeRecordReferences(userId: string, recordId: string, transaction: NonNullable<TransactionOptions["transaction"]>) {
    await new ProjectRepository(transaction).cleanupRecord(userId, recordId);
  }
  static create(db: Kysely<DB>, records: RecordService, media: MediaService, embeddings: ProjectEmbeddingProvider) { return new ProjectService(db, records, media, embeddings); }
  async find(userId: string, id: string, options: TransactionOptions = {}) {
    if (!uuid.safeParse(id).success) return null;
    const row = await new ProjectRepository(options.transaction ?? this.db).project(userId, id);
    return row ? projectEntity(row) : null;
  }
  async findBySession(userId: string, sessionId: string) {
    const row = await this.db.selectFrom("projects").selectAll().where("user_id", "=", userId).where("session_id", "=", sessionId).executeTakeFirst();
    return row ? projectEntity(row) : null;
  }
  async list(userId: string, input: Pagination & { status?: ProjectStatus }) {
    const parsed = projectListSchema.safeParse(input);
    if (!parsed.success) return failure("INVALID_INPUT");
    const { limit, status } = parsed.data;
    const scope = ["projects", userId, status];
    const cursor = decodeCursor(input.cursor, scope);
    if (cursor === null) return failure("INVALID_CURSOR");
    const rows = await new ProjectRepository(this.db).projects(userId, status, cursor, limit + 1);
    const result = page(rows, limit, scope, r => ({ time: r.updated_at.toISOString(), id: r.project_id }));
    return success({ ...result, data: result.data.map(r => { const { content: _, ...summary } = projectEntity({ ...r, content: "" }); return summary; }) });
  }
  private async ensureProjectEmbeddings(userId: string) {
    const missing = await this.db.selectFrom("projects").select(["project_id", "summary"])
      .where("user_id", "=", userId).where("status", "!=", "archived").where("embedding", "is", null).execute();
    for (const row of missing) {
      const embedding = await embedProjectText(this.embeddings, row.summary);
      await this.db.updateTable("projects").set({ embedding }).where("user_id", "=", userId)
        .where("project_id", "=", row.project_id).where("summary", "=", row.summary)
        .where("embedding", "is", null).execute();
    }
  }
  async search(userId: string, input: { query: string }) {
    const parsed = z.object({ query: z.string().trim().min(1).max(2000) }).strict().safeParse(input);
    if (!parsed.success) return failure("INVALID_INPUT");
    try {
      await this.ensureProjectEmbeddings(userId);
      const embedding = await embedProjectText(this.embeddings, parsed.data.query);
      return success({ data: await new ProjectRepository(this.db).search(userId, embedding) });
    } catch { return failure("EMBEDDING_UNAVAILABLE"); }
  }
  /** Internal discovery: semantic + lexical + recent candidates, with no content-value classification heuristics. */
  async candidates(userId: string, sourceContent: unknown) {
    const query = discoveryText(sourceContent).trim();
    const recent = await new ProjectRepository(this.db).projects(userId, undefined, undefined, 7);
    const scan = await this.db.selectFrom("projects").select(["project_id","title","summary","goal"])
      .where("user_id","=",userId).where("status","!=","archived")
      .orderBy("updated_at","desc").limit(200).execute();
    let semantic: Awaited<ReturnType<ProjectRepository["search"]>> = [];
    let semanticAvailable = false;
    if (query) {
      try {
        await this.ensureProjectEmbeddings(userId);
        const embedding = await embedProjectText(this.embeddings, query);
        semantic = await new ProjectRepository(this.db).search(userId, embedding, 8);
        semanticAvailable = true;
      } catch { /* Degrade to lexical and recent candidates, without hiding all Project context. */ }
    }
    const hints = new Map<string, { source: "explicit" | "semantic" | "lexical" | "recent"; similarity?: number }>();
    const normalizedQuery=query.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu,"");
    for(const project of scan){
      const title=project.title.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu,"");
      if(title.length >= 4 && normalizedQuery.includes(title))hints.set(project.project_id,{source:"explicit"});
    }
    for (const match of semantic) if(!hints.has(match.projectId)) hints.set(match.projectId, { source: "semantic", similarity: match.similarity });
    const sourceGrams=grams(query);
    const lexical=scan.map(project=>({id:project.project_id, score:lexicalOverlap(sourceGrams,grams([project.title,project.summary,JSON.stringify(project.goal)].join(" ")))}))
      .filter(row=>row.score>0).sort((a,b)=>b.score-a.score).slice(0,5);
    for(const match of lexical)if(!hints.has(match.id))hints.set(match.id,{source:"lexical",similarity:match.score});
    for (const project of recent) if (!hints.has(project.project_id)) hints.set(project.project_id, { source: "recent" });
    const candidates = await Promise.all([...hints].slice(0, 14).map(async ([id, hint]) => {
      const project = await this.find(userId, id);
      if (!project || project.status === "archived") return null;
      return { projectId: project.projectId, title: project.title, summary: project.summary.slice(0,1000),
        goal: project.goal, status: project.status, version: project.version,
        contentExcerpt: project.content.slice(0, 700), ...hint };
    }));
    return { search: semanticAvailable ? "semantic_lexical_recent" : "lexical_recent_only", candidates: candidates.filter(c => c !== null) };
  }
  async recordsPage(userId: string, id: string, input: Pagination) {
    if (!uuid.safeParse(id).success) return failure("INVALID_INPUT");
    if (!paginationSchema.safeParse(input).success) return failure("INVALID_INPUT");
    const scope = ["project-records", userId, id], cursor = decodeCursor(input.cursor, scope);
    if (cursor === null) return failure("INVALID_CURSOR");
    // A shared transaction makes the link page consistent with concurrent Record deletion.
    return this.db.transaction().setIsolationLevel("repeatable read").execute(async trx => {
      const repo = new ProjectRepository(trx);
      if (!await repo.project(userId, id)) return failure("NOT_FOUND");
      const rows = await repo.links(userId, "project", id, cursor, input.limit + 1);
      const result = page(rows, input.limit, scope, r => ({ time: r.record_event_at.toISOString(), id: r.record_id }));
      const records = await this.records.findMany(userId, result.data.map(r => r.record_id), { transaction: trx });
      return success({ ...result, data: records });
    });
  }
  async detail(userId: string, id: string) {
    if (!uuid.safeParse(id).success) return failure("INVALID_INPUT");
    return this.db.transaction().setIsolationLevel("repeatable read").execute(async trx => {
      const repo = new ProjectRepository(trx), row = await repo.project(userId, id);
      if (!row) return failure("NOT_FOUND");
      const links = await repo.links(userId, "project", id, undefined, 5);
      return success({ ...projectEntity(row), recordCount: await repo.count(userId, "project", id), referenceRecords: await this.records.findMany(userId, links.map(r => r.record_id), { transaction: trx }) });
    });
  }
  async update(userId: string, id: string, expectedVersion: number, input: ProjectPatch, options: TransactionOptions = {}) {
    if (!uuid.safeParse(id).success || !versionSchema.safeParse(expectedVersion).success) return failure("INVALID_INPUT");
    const parsed = patchSchema.safeParse(input);
    if (!parsed.success) return failure("INVALID_INPUT");
    const patch = parsed.data;
    const createdMediaKeys: string[] = [];
    const execute = async (transaction: NonNullable<TransactionOptions["transaction"]>) => {
      const repo = new ProjectRepository(transaction);
      const row = await repo.project(userId, id, true);
      if (!row) return failure("NOT_FOUND");
      if (row.status === "archived" || row.status === "queued") return failure("INVALID_STATE");
      if (row.version !== expectedVersion) return failure("VERSION_CONFLICT");
      const fullContent = patch.content ?? row.content;
      const inspected = inspectProjectContent(fullContent);
      if (inspected.kind === "error") return inspected;
      const cover = patch.coverMediaId === undefined ? row.cover_media_id : patch.coverMediaId;
      const values: Partial<DB["projects"]> = {};
      if (patch.title !== undefined) values.title = patch.title;
      if (patch.summary !== undefined && patch.summary !== row.summary) {
        try { values.embedding = await embedProjectText(this.embeddings, patch.summary); }
        catch { return failure("EMBEDDING_UNAVAILABLE"); }
        values.summary = patch.summary;
      }
      const mapping = await this.media.copyFinalReferences(userId, id, [...inspected.data, ...(cover ? [cover] : [])], transaction, createdMediaKeys);
      const content = fullContent.replace(/fanto-media:\/\/([0-9a-f-]{36})/gi, (match, mediaId: string) =>
        mapping[mediaId.toLowerCase()] ? `fanto-media://${mapping[mediaId.toLowerCase()]}` : match);
      const canonicalCover = cover ? mapping[cover] ?? cover : null;
      if (canonicalCover !== row.cover_media_id) values.cover_media_id = canonicalCover;
      if (content !== row.content) values.content = content;
      if (patch.goal !== undefined) values.goal = patch.goal;
      if (Object.entries(values).every(([key, value]) => row[key as keyof typeof row] === value)) return success(projectEntity(row));
      return success(projectEntity(await repo.updateProject(userId, id, values)));
    };
    try { return await (options.transaction ? execute(options.transaction) : this.db.transaction().execute(execute)); }
    catch (error) {
      await this.media.cleanupUncommittedProjectObjects(createdMediaKeys);
      if (error instanceof Error && /MEDIA_NOT_READY|not found|NoSuchKey/i.test(error.message)) return failure("MEDIA_NOT_READY");
      throw error;
    }
  }
  async claimExecution(userId:string, projectId:string, from:readonly ("queued"|"completed"|"failed")[], to:"running") {
    const row=await this.db.updateTable("projects").set({status:to,updated_at:new Date()})
      .where("user_id","=",userId).where("project_id","=",projectId).where("status","in", [...from])
      .returning("project_id").executeTakeFirst();
    return Boolean(row);
  }
  async finishExecution(userId:string, projectId:string, status:"completed"|"failed") {
    await this.db.updateTable("projects").set({status,updated_at:new Date()})
      .where("user_id","=",userId).where("project_id","=",projectId).where("status","=","running").execute();
  }
  async bindSession(userId: string, projectId: string, sessionId: string) {
    const existing = await this.find(userId, projectId);
    if (!existing) return null;
    if (existing.sessionId) return existing.sessionId;
    const row = await this.db.updateTable("projects").set({ session_id: sessionId }).where("user_id", "=", userId)
      .where("project_id", "=", projectId).where("session_id", "is", null).returning("session_id").executeTakeFirst();
    return row?.session_id ?? (await this.find(userId, projectId))?.sessionId ?? null;
  }
  async normalizeLegacyMedia() {
    // Run before serving traffic; archived Projects must be normalized too.
    const projects = await this.db.selectFrom("projects").select(["user_id", "project_id"]).execute();
    for (const project of projects) {
      await this.db.transaction().execute(async trx => {
        const repo = new ProjectRepository(trx);
        const row = await repo.project(project.user_id, project.project_id, true);
        if (!row) return;
        const inspected = inspectProjectContent(row.content);
        if (inspected.kind === "error") throw new Error(`Cannot normalize project ${row.project_id}: ${inspected.code}`);
        const ids = [...inspected.data, ...(row.cover_media_id ? [row.cover_media_id] : [])];
        if (!ids.length) return;
        const mapping = await this.media.copyFinalReferences(row.user_id, row.project_id, ids, trx);
        if (!Object.keys(mapping).length) return;
        const content = row.content.replace(/fanto-media:\/\/([0-9a-f-]{36})/gi, (match, id: string) =>
          mapping[id.toLowerCase()] ? `fanto-media://${mapping[id.toLowerCase()]}` : match);
        await repo.updateProject(row.user_id, row.project_id, {
          content, cover_media_id: row.cover_media_id ? mapping[row.cover_media_id] ?? row.cover_media_id : null,
        });
      });
    }
  }
  async listReferencedMediaIds(userId: string, id: string) {
    const project = await this.find(userId, id);
    if (!project) return failure("NOT_FOUND");
    const parsed = inspectProjectContent(project.content);
    if (parsed.kind === "error") return parsed;
    return success([...new Set([...parsed.data, ...(project.coverMediaId ? [project.coverMediaId] : [])])]);
  }
  async archive(userId: string, id: string, expectedVersion: number) {
    if (!uuid.safeParse(id).success || !versionSchema.safeParse(expectedVersion).success) return failure("INVALID_INPUT");
    return this.db.transaction().execute(async trx => {
      const repo = new ProjectRepository(trx), row = await repo.project(userId, id, true);
      if (!row) return failure("NOT_FOUND");
      if (row.status === "archived") return success(projectEntity(row));
      if (row.status === "queued" || row.status === "running") return failure("INVALID_STATE");
      if (row.version !== expectedVersion) return failure("VERSION_CONFLICT");
      const archived = await trx.updateTable("projects")
        .set({ status: "archived", updated_at: new Date() })
        .where("user_id", "=", userId).where("project_id", "=", id)
        .returningAll().executeTakeFirstOrThrow();
      return success(projectEntity(archived));
    });
  }
}
