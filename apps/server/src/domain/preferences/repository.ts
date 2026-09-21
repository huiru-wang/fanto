import type { PreferenceCategory, PreferenceSource, UserPreference } from "./model.js";

export type PreferenceMutationResult =
  | { kind: "ok"; preference: UserPreference }
  | { kind: "not_found" }
  | { kind: "conflict"; preference: UserPreference };

export interface PreferenceRepository {
  listByUser(userId: string, limit: number): Promise<UserPreference[]>;
  findById(userId: string, preferenceId: string): Promise<UserPreference | undefined>;
  findSame(userId: string, category: PreferenceCategory, content: string): Promise<UserPreference | undefined>;
  create(input: { userId: string; category: PreferenceCategory; content: string; source: PreferenceSource }): Promise<UserPreference>;
  update(input: {
    userId: string;
    preferenceId: string;
    expectedVersion: number;
    category: PreferenceCategory;
    content: string;
    source: PreferenceSource;
  }): Promise<PreferenceMutationResult>;
  delete(input: { userId: string; preferenceId: string; expectedVersion: number }): Promise<PreferenceMutationResult>;
}
