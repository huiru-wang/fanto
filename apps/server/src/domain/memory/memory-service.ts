import type { Kysely } from "kysely";
import type { DB } from "../../infrastructure/database/schema.js";
import type { EmbeddingProvider } from "./embedding-provider.js";
import { memoryKinds, type Memory, type MemoryKind, type MemorySearchResult } from "./model.js";
import { PostgresMemoryRepository } from "./postgres-repository.js";
import type { MemoryRepository } from "./repository.js";

const MAX_MEMORIES_PER_USER = 50;
const MAX_PREFERENCES_PER_USER = 20;
const MAX_CONTENT_LENGTH = 1_000;

function normalizeContent(content: string): string {
  const normalized = content.trim();
  if (!normalized) throw new Error("Memory content must not be empty");
  if (normalized.length > MAX_CONTENT_LENGTH) throw new Error(`Memory content must not exceed ${MAX_CONTENT_LENGTH} characters`);
  return normalized;
}

function assertKind(kind: string): asserts kind is MemoryKind {
  if (!(memoryKinds as readonly string[]).includes(kind)) throw new Error("Unknown memory kind");
}

export class MemoryService {
  constructor(private readonly repository: MemoryRepository, private readonly embeddings: EmbeddingProvider) {}

  static create(db: Kysely<DB>, embeddings: EmbeddingProvider): MemoryService {
    return new MemoryService(new PostgresMemoryRepository(db), embeddings);
  }

  async list(userId: string, input: { kind?: MemoryKind; limit?: number } = {}): Promise<Memory[]> {
    if (input.kind) assertKind(input.kind);
    return this.repository.list(userId, { kind: input.kind, limit: Math.min(input.limit ?? MAX_MEMORIES_PER_USER, MAX_MEMORIES_PER_USER) });
  }

  async search(userId: string, query: string, limit = 10, kinds?: readonly MemoryKind[]): Promise<MemorySearchResult[]> {
    if (kinds) {
      if (kinds.length === 0) return [];
      for (const kind of kinds) assertKind(kind);
    }
    const normalized = normalizeContent(query);
    return this.repository.search({ userId, embedding: await this.embeddings.embed(normalized), limit: Math.min(Math.max(limit, 1), 10), kinds });
  }

  async create(userId: string, input: { kind: MemoryKind; content: string }): Promise<Memory> {
    assertKind(input.kind);
    const content = normalizeContent(input.content);
    if (await this.repository.countByUser(userId) >= MAX_MEMORIES_PER_USER) throw new Error(`A user can store at most ${MAX_MEMORIES_PER_USER} memories`);
    if (input.kind === "interaction_preferences" && await this.repository.countByUser(userId, "interaction_preferences") >= MAX_PREFERENCES_PER_USER) throw new Error(`A user can store at most ${MAX_PREFERENCES_PER_USER} interaction preference memories`);
    return this.repository.create({ memoryId: crypto.randomUUID(), userId, kind: input.kind, content, embedding: await this.embeddings.embed(content) });
  }

  async update(userId: string, memoryId: string, input: { kind: MemoryKind; content: string }): Promise<Memory | undefined> {
    assertKind(input.kind);
    const existing = await this.repository.find(userId, memoryId);
    if (!existing) return undefined;
    if (input.kind === "interaction_preferences" && existing.kind !== "interaction_preferences" && await this.repository.countByUser(userId, "interaction_preferences") >= MAX_PREFERENCES_PER_USER) throw new Error(`A user can store at most ${MAX_PREFERENCES_PER_USER} interaction preference memories`);
    const content = normalizeContent(input.content);
    return this.repository.update({ userId, memoryId, kind: input.kind, content, embedding: await this.embeddings.embed(content) });
  }

  remove(userId: string, memoryId: string): Promise<boolean> {
    return this.repository.remove(userId, memoryId);
  }
}
