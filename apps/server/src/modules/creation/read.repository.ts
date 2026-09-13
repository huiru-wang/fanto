import type { Kysely } from "kysely";
import type { DB } from "../../infrastructure/schema.js";

const parse = (v: string | null) => v ? JSON.parse(v) : null;
export class CreationReadRepository {
  constructor(private readonly db: Kysely<DB>) {}
  kinds() { return this.db.selectFrom("creation_kinds").selectAll().orderBy("name").execute(); }
  async overview(userId: string) { const tracking = await this.db.selectFrom("creations").selectAll().where("user_id", "=", userId).where("status", "=", "active").orderBy("updated_at", "desc").orderBy("creation_id", "desc").limit(3).execute(); return { tracking, kinds: await this.db.selectFrom("creations").innerJoin("creation_kinds", "creation_kinds.kind_id", "creations.kind_id").select(["creation_kinds.kind_id", "creation_kinds.name", "creation_kinds.title"]).where("creations.user_id", "=", userId).groupBy(["creation_kinds.kind_id", "creation_kinds.name", "creation_kinds.title"]).execute() }; }
  async creation(userId: string, id: string) { return this.db.selectFrom("creations").innerJoin("creation_kinds", "creation_kinds.kind_id", "creations.kind_id").selectAll("creations").select(["creation_kinds.name as kind_name", "creation_kinds.title as kind_title"]).where("creations.user_id", "=", userId).where("creations.creation_id", "=", id).executeTakeFirst(); }
  async list(userId: string, kindId?: string) { let q = this.db.selectFrom("creations").selectAll().where("user_id", "=", userId); if (kindId) q = q.where("kind_id", "=", kindId); return q.orderBy("updated_at", "desc").orderBy("creation_id", "desc").execute(); }
  async linkedRecords(userId: string, targetId: string, targetType: "creation" | "creation_proposal", cursor?: { at: string; id: string }, limit = 20) { let q = this.db.selectFrom("entity_relations").select(["source_entity_id", "source_created_at"]).where("user_id", "=", userId).where("target_entity_type", "=", targetType).where("target_entity_id", "=", targetId).where("relation_type", "=", targetType === "creation" ? "record_creation" : "record_creation_proposal"); if (cursor) q = q.where(eb => eb.or([eb("source_created_at", "<", cursor.at), eb.and([eb("source_created_at", "=", cursor.at), eb("source_entity_id", "<", cursor.id)])])); return q.orderBy("source_created_at", "desc").orderBy("source_entity_id", "desc").limit(limit + 1).execute(); }
  recordsByIds(userId: string, ids: string[]) { return ids.length ? this.db.selectFrom("records").selectAll().where("user_id", "=", userId).where("record_id", "in", ids).execute() : Promise.resolve([]); }
}
