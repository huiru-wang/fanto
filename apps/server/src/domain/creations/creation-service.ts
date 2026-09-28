import { CreationReadRepository } from "./creation-repository.js";
import type { Kysely } from "kysely";
import type { DB } from "../../infrastructure/database/schema.js";

const cursor = (s?: string) => { if (!s) return undefined; try { const v = JSON.parse(Buffer.from(s, "base64url").toString()); return typeof v.at === "string" && typeof v.id === "string" ? v : undefined; } catch { return undefined; } };
const encode = (v: { source_created_at: string; source_entity_id: string }) => Buffer.from(JSON.stringify({ at: v.source_created_at, id: v.source_entity_id })).toString("base64url");

export class CreationService {
  constructor(private readonly repository: CreationReadRepository) {}
  static create(db: Kysely<DB>) { return new CreationService(new CreationReadRepository(db)); }
  kinds() { return this.repository.kinds(); }
  overview(userId: string) { return this.repository.overview(userId); }
  list(userId: string, kindId?: string) { return this.repository.list(userId, kindId); }
  creation(userId: string, id: string) { return this.repository.creation(userId, id); }
  async linkedRecords(userId: string, id: string, rawCursor: string | undefined, limit: number) {
    const links = await this.repository.linkedRecords(userId, id, "creation", cursor(rawCursor), limit); const page = links.slice(0, limit);
    const rows = await this.repository.recordsByIds(userId, page.map(x => x.source_entity_id));
    if (rows.length !== page.length) return { kind: "integrity_error" } as const;
    const byId = new Map(rows.map(x => [x.record_id, x]));
    return { kind: "ok", data: page.map(x => byId.get(x.source_entity_id)), hasMore: links.length > limit, nextCursor: links.length > limit ? encode(page.at(-1)!) : null } as const;
  }
}
