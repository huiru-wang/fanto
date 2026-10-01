import type { Kysely } from "kysely";
import type { DB } from "../../infrastructure/database/schema.js";
import type { RecordService } from "../records/index.js";
import { ProjectRepository, type ProjectCursor, type ProjectRecordCursor } from "./project-repository.js";
import type { Project, ProjectStatus } from "./project.js";

const statuses = new Set<ProjectStatus>(["proposed", "active", "archived", "rejected"]);

function encode(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function decode<T>(raw: string | undefined, parse: (value: any) => T | null): T | undefined {
  if (!raw) return undefined;
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString());
    return parse(value) ?? undefined;
  } catch {
    return undefined;
  }
}

export class ProjectService {
  constructor(private readonly repository: ProjectRepository, private readonly records: RecordService) {}

  static create(db: Kysely<DB>, records: RecordService) {
    return new ProjectService(new ProjectRepository(db), records);
  }

  parseStatus(raw: string | undefined): ProjectStatus | undefined | null {
    if (raw === undefined) return undefined;
    return statuses.has(raw as ProjectStatus) ? raw as ProjectStatus : null;
  }

  async list(userId: string, status: ProjectStatus | undefined, rawCursor: string | undefined, limit: number) {
    const cursor = decode<ProjectCursor>(rawCursor, value => {
      if (typeof value?.updatedAt !== "string" || typeof value?.projectId !== "string") return null;
      const updatedAt = new Date(value.updatedAt);
      return Number.isNaN(updatedAt.getTime()) ? null : { updatedAt, projectId: value.projectId };
    });
    if (rawCursor && !cursor) return { kind: "invalid_cursor" } as const;
    const rows = await this.repository.list(userId, status, cursor, limit + 1);
    const page = rows.slice(0, limit);
    const hasMore = rows.length > limit;
    return {
      kind: "ok",
      data: page.map(row => this.present(row)),
      hasMore,
      nextCursor: hasMore && page.at(-1) ? encode({ updatedAt: page.at(-1)!.updated_at.toISOString(), projectId: page.at(-1)!.project_id }) : null,
      pageSize: limit,
    } as const;
  }

  async find(userId: string, projectId: string) {
    const row = await this.repository.find(userId, projectId);
    return row ? this.present(row) : null;
  }

  async recordsPage(userId: string, projectId: string, rawCursor: string | undefined, limit: number) {
    if (!await this.repository.find(userId, projectId)) return { kind: "not_found" } as const;
    const cursor = decode<ProjectRecordCursor>(rawCursor, value => {
      if (typeof value?.recordEventAt !== "string" || typeof value?.recordId !== "string") return null;
      const recordEventAt = new Date(value.recordEventAt);
      return Number.isNaN(recordEventAt.getTime()) ? null : { recordEventAt, recordId: value.recordId };
    });
    if (rawCursor && !cursor) return { kind: "invalid_cursor" } as const;
    const links = await this.repository.recordLinks(userId, projectId, cursor, limit + 1);
    const page = links.slice(0, limit);
    const records = await this.records.findMany(userId, page.map(link => link.record_id));
    if (records.length !== page.length) return { kind: "integrity_error" } as const;
    const byId = new Map(records.map(record => [record.id, record]));
    const hasMore = links.length > limit;
    return {
      kind: "ok",
      data: page.map(link => byId.get(link.record_id)!),
      hasMore,
      nextCursor: hasMore && page.at(-1) ? encode({ recordEventAt: page.at(-1)!.record_event_at.toISOString(), recordId: page.at(-1)!.record_id }) : null,
      pageSize: limit,
    } as const;
  }

  async confirm(userId: string, projectId: string) {
    const current = await this.repository.find(userId, projectId);
    if (!current) return { kind: "not_found" } as const;
    if (current.status !== "proposed") return { kind: "invalid_state" } as const;
    const row = await this.repository.confirm(userId, projectId, new Date());
    return row ? { kind: "ok", project: this.present(row) } as const : { kind: "invalid_state" } as const;
  }

  async reject(userId: string, projectId: string) {
    const current = await this.repository.find(userId, projectId);
    if (!current) return { kind: "not_found" } as const;
    if (current.status !== "proposed") return { kind: "invalid_state" } as const;
    const row = await this.repository.reject(userId, projectId, new Date());
    return row ? { kind: "ok", project: this.present(row) } as const : { kind: "invalid_state" } as const;
  }

  private present(row: any): Project {
    return {
      projectId: row.project_id,
      title: row.title,
      content: row.content,
      status: row.status,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
