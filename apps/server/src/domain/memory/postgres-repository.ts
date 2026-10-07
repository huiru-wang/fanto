import { sql, type Kysely } from "kysely";
import type { DB } from "../../infrastructure/database/schema.js";
import type { Memory, MemoryKind, MemorySearchResult } from "./model.js";
import type { MemoryRepository } from "./repository.js";

const vectorLiteral = (embedding: number[]) => JSON.stringify(embedding);
const iso = (value: Date | string): string => value instanceof Date ? value.toISOString() : new Date(value).toISOString();

function toMemory(row: {
  memory_id: string;
  user_id: string;
  kind: MemoryKind;
  content: string;
  created_at: Date | string;
  updated_at: Date | string;
}): Memory {
  return {
    memoryId: row.memory_id,
    userId: row.user_id,
    kind: row.kind,
    content: row.content,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export class PostgresMemoryRepository implements MemoryRepository {
  constructor(private readonly db: Kysely<DB>) {}

  async countByUser(userId: string, kind?: MemoryKind): Promise<number> {
    let query = this.db.selectFrom("memories").select(({ fn }) => fn.count<number>("memory_id").as("count")).where("user_id", "=", userId);
    if (kind) query = query.where("kind", "=", kind);
    return Number((await query.executeTakeFirstOrThrow()).count);
  }

  async create(input: Omit<Memory, "createdAt" | "updatedAt"> & { embedding: number[] }): Promise<Memory> {
    const now = new Date();
    const row = await sql<{
      memory_id: string; user_id: string; kind: MemoryKind; content: string; created_at: Date; updated_at: Date;
    }>`INSERT INTO memories (memory_id, user_id, kind, content, embedding, created_at, updated_at)
      VALUES (${input.memoryId}, ${input.userId}, ${input.kind}, ${input.content}, ${vectorLiteral(input.embedding)}::vector, ${now}, ${now})
      RETURNING memory_id, user_id, kind, content, created_at, updated_at`.execute(this.db);
    return toMemory(row.rows[0]!);
  }

  async find(userId: string, memoryId: string): Promise<Memory | undefined> {
    const row = await this.db.selectFrom("memories").selectAll().where("user_id", "=", userId).where("memory_id", "=", memoryId).executeTakeFirst();
    return row ? toMemory(row) : undefined;
  }

  async list(userId: string, input: { kind?: MemoryKind; limit: number }): Promise<Memory[]> {
    let query = this.db.selectFrom("memories").selectAll().where("user_id", "=", userId);
    if (input.kind) query = query.where("kind", "=", input.kind);
    const rows = await query.orderBy("updated_at", "desc").orderBy("memory_id", "desc").limit(input.limit).execute();
    return rows.map(toMemory);
  }

  async update(input: Pick<Memory, "userId" | "memoryId" | "kind" | "content"> & { embedding: number[] }): Promise<Memory | undefined> {
    const now = new Date();
    const row = await sql<{
      memory_id: string; user_id: string; kind: MemoryKind; content: string; created_at: Date; updated_at: Date;
    }>`UPDATE memories SET kind = ${input.kind}, content = ${input.content}, embedding = ${vectorLiteral(input.embedding)}::vector, updated_at = ${now}
      WHERE user_id = ${input.userId} AND memory_id = ${input.memoryId}
      RETURNING memory_id, user_id, kind, content, created_at, updated_at`.execute(this.db);
    return row.rows[0] ? toMemory(row.rows[0]) : undefined;
  }

  async remove(userId: string, memoryId: string): Promise<boolean> {
    const row = await this.db.deleteFrom("memories").where("user_id", "=", userId).where("memory_id", "=", memoryId).returning("memory_id").executeTakeFirst();
    return Boolean(row);
  }

  async search(input: { userId: string; embedding: number[]; limit: number }): Promise<MemorySearchResult[]> {
    const rows = await sql<{
      memory_id: string; user_id: string; kind: MemoryKind; content: string; created_at: Date; updated_at: Date; distance: number;
    }>`SELECT memory_id, user_id, kind, content, created_at, updated_at,
        (embedding <-> ${vectorLiteral(input.embedding)}::vector)::float8 AS distance
      FROM memories WHERE user_id = ${input.userId}
      ORDER BY embedding <-> ${vectorLiteral(input.embedding)}::vector
      LIMIT ${input.limit}`.execute(this.db);
    return rows.rows.map(row => ({ ...toMemory(row), distance: Number(row.distance) }));
  }
}
