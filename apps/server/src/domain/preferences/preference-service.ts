import type { PreferenceCategory, PreferenceSource, UserPreference } from "./model.js";
import type { PreferenceMutationResult, PreferenceRepository } from "./repository.js";

export type PreferenceCreateResult =
  | { kind: "ok"; preference: UserPreference; reused: boolean }
  | { kind: "limit_reached" };

export class PreferenceService {
  static readonly MAX_PREFERENCES = 20;

  constructor(private readonly repository: PreferenceRepository) {}

  list(userId: string): Promise<UserPreference[]> {
    return this.repository.listByUser(userId, PreferenceService.MAX_PREFERENCES);
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
      if (refreshed.kind === "ok") return { kind: "ok", preference: refreshed.preference, reused: true };
      const latest = await this.repository.findSame(input.userId, input.category, input.content);
      if (latest) return { kind: "ok", preference: latest, reused: true };
    }
    if ((await this.repository.listByUser(input.userId, PreferenceService.MAX_PREFERENCES)).length >= PreferenceService.MAX_PREFERENCES) {
      return { kind: "limit_reached" };
    }
    return { kind: "ok", preference: await this.repository.create(input), reused: false };
  }

  update(input: {
    userId: string;
    preferenceId: string;
    expectedVersion: number;
    category: PreferenceCategory;
    content: string;
    source: PreferenceSource;
  }): Promise<PreferenceMutationResult> {
    return this.repository.update(input);
  }

  delete(input: { userId: string; preferenceId: string; expectedVersion: number }): Promise<PreferenceMutationResult> {
    return this.repository.delete(input);
  }
}
