import type { Kysely } from "kysely";
import type { DB } from "../../infrastructure/database/schema.js";
import type { ProjectStatus } from "./project.js";

export type ProjectCursor = { updatedAt: Date; projectId: string };
export type ProjectRecordCursor = { recordEventAt: Date; recordId: string };

export class ProjectRepository {
  constructor(private readonly db: Kysely<DB>) {}

  async list(userId: string, status: ProjectStatus | undefined, cursor: ProjectCursor | undefined, limit: number) {
    let query = this.db.selectFrom("projects").selectAll().where("user_id", "=", userId);
    query = status
      ? query.where("status", "=", status)
      : query.where("status", "in", ["active", "archived"]);
    if (cursor) {
      query = query.where(eb => eb.or([
        eb("updated_at", "<", cursor.updatedAt),
        eb.and([eb("updated_at", "=", cursor.updatedAt), eb("project_id", "<", cursor.projectId)]),
      ]));
    }
    return query.orderBy("updated_at", "desc").orderBy("project_id", "desc").limit(limit).execute();
  }

  find(userId: string, projectId: string) {
    return this.db.selectFrom("projects").selectAll()
      .where("user_id", "=", userId)
      .where("project_id", "=", projectId)
      .executeTakeFirst();
  }

  async recordLinks(userId: string, projectId: string, cursor: ProjectRecordCursor | undefined, limit: number) {
    let query = this.db.selectFrom("project_records")
      .select(["record_id", "record_event_at"])
      .where("user_id", "=", userId)
      .where("project_id", "=", projectId);
    if (cursor) {
      query = query.where(eb => eb.or([
        eb("record_event_at", "<", cursor.recordEventAt),
        eb.and([eb("record_event_at", "=", cursor.recordEventAt), eb("record_id", "<", cursor.recordId)]),
      ]));
    }
    return query.orderBy("record_event_at", "desc").orderBy("record_id", "desc").limit(limit).execute();
  }

  confirm(userId: string, projectId: string, updatedAt: Date) {
    return this.db.updateTable("projects")
      .set({ status: "active", updated_at: updatedAt })
      .where("user_id", "=", userId)
      .where("project_id", "=", projectId)
      .where("status", "=", "proposed")
      .returningAll()
      .executeTakeFirst();
  }

  reject(userId: string, projectId: string, updatedAt: Date) {
    return this.db.updateTable("projects")
      .set({ status: "rejected", updated_at: updatedAt })
      .where("user_id", "=", userId)
      .where("project_id", "=", projectId)
      .where("status", "=", "proposed")
      .returningAll()
      .executeTakeFirst();
  }
}
