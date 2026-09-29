import type { PreferenceCategory, PreferenceSource, UserPreference } from "./model.js";
import type { PreferenceMutationResult, PreferenceRepository } from "./repository.js";
import { PostgresPreferenceRepository } from "./postgres-repository.js";
import type { Kysely } from "kysely";
import type { DB } from "../../infrastructure/database/schema.js";

export type PreferenceCreateResult =
  | { kind: "ok"; preference: UserPreference; reused: boolean }
  | { kind: "limit_reached" };

type PreferenceListCache = {
  getOrLoad(key: string, loader: () => Promise<UserPreference[]>): Promise<UserPreference[]>;
  delete(key: string): void;
};

export class PreferenceService {
  static readonly MAX_PREFERENCES = 20;

  constructor(
    private readonly repository: PreferenceRepository,
    private readonly listCache?: PreferenceListCache,
  ) {}

  static create(db: Kysely<DB>, listCache?: PreferenceListCache) {
    return new PreferenceService(new PostgresPreferenceRepository(db), listCache);
  }

  list(userId: string): Promise<UserPreference[]> {
    if (!this.listCache) return this.repository.listByUser(userId, PreferenceService.MAX_PREFERENCES);
    return this.listCache.getOrLoad(
      userId,
      () => this.repository.listByUser(userId, PreferenceService.MAX_PREFERENCES),
    );
  }

  async create(input: {
    userId: string;
    category: PreferenceCategory;
    content: string;
    source: PreferenceSource;
  }): Promise<PreferenceCreateResult> {
    const same = await this.repository.findSame(input.userId, input.category, input.content);
    if (same) {
      const refreshed = await this.repository.update({
        ...input,
        preferenceId: same.preferenceId,
        expectedVersion: same.version,
      });
      if (refreshed.kind === "ok") {
        this.invalidateList(input.userId);
        return { kind: "ok", preference: refreshed.preference, reused: true };
      }
      const latest = await this.repository.findSame(input.userId, input.category, input.content);
      if (latest) return { kind: "ok", preference: latest, reused: true };
    }
    if ((await this.list(input.userId)).length >= PreferenceService.MAX_PREFERENCES) {
      return { kind: "limit_reached" };
    }
    const preference = await this.repository.create(input);
    this.invalidateList(input.userId);
    return { kind: "ok", preference, reused: false };
  }

  async update(input: {
    userId: string;
    preferenceId: string;
    expectedVersion: number;
    category: PreferenceCategory;
    content: string;
    source: PreferenceSource;
  }): Promise<PreferenceMutationResult> {
    const result = await this.repository.update(input);
    if (result.kind === "ok") this.invalidateList(input.userId);
    return result;
  }

  async delete(input: { userId: string; preferenceId: string; expectedVersion: number }): Promise<PreferenceMutationResult> {
    const result = await this.repository.delete(input);
    if (result.kind === "ok") this.invalidateList(input.userId);
    return result;
  }

  private invalidateList(userId: string) {
    this.listCache?.delete(userId);
  }
}
