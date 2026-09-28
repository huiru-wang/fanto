import type { MediaService } from "../domain/media/index.js";
import type { PreferenceCategory, PreferenceService, UserPreference } from "../domain/preferences/index.js";
import type { RecordService } from "../domain/records/index.js";

export type AgentRequestContext = { userId: string; traceId?: string; signal?: AbortSignal };
export type AgentRecord = NonNullable<Awaited<ReturnType<RecordService["find"]>>>;
export type AgentRecordList = Awaited<ReturnType<RecordService["list"]>>;
export type AgentRecordSearch = { data: Awaited<ReturnType<RecordService["search"]>> };
export type AgentMediaMetadata = NonNullable<Awaited<ReturnType<MediaService["readyMetadata"]>>>;
export type AgentPreference = UserPreference;
export type AgentPreferenceList = { data: AgentPreference[] };
export type AgentPreferenceCategory = PreferenceCategory;

export type AgentBusinessServices = {
  getRecord(context: AgentRequestContext, recordId: string): Promise<AgentRecord>;
  listRecords(context: AgentRequestContext, input: { limit: number; cursor?: string }): Promise<AgentRecordList>;
  searchRecords(context: AgentRequestContext, input: { query: string; limit: number }): Promise<AgentRecordSearch>;
  getMediaMetadata(context: AgentRequestContext, mediaId: string): Promise<AgentMediaMetadata>;
  listPreferences(context: AgentRequestContext): Promise<AgentPreferenceList>;
  createPreference(context: AgentRequestContext, input: { category: AgentPreferenceCategory; content: string; source: { sessionId: string; messageId: string; quote: string } }): Promise<{ preference: AgentPreference; reused: boolean }>;
  updatePreference(context: AgentRequestContext, preferenceId: string, input: { expectedVersion: number; category: AgentPreferenceCategory; content: string; source: { sessionId: string; messageId: string; quote: string } }): Promise<AgentPreference>;
  deletePreference(context: AgentRequestContext, preferenceId: string, expectedVersion: number): Promise<{ preferenceId: string }>;
};

async function withRunAbort<T>(context: AgentRequestContext, operation: () => Promise<T>): Promise<T> {
  context.signal?.throwIfAborted();
  const result = await operation();
  context.signal?.throwIfAborted();
  return result;
}

export function createAgentBusinessServices(services: {
  records: RecordService;
  media: MediaService;
  preferences: PreferenceService;
}): AgentBusinessServices {
  return {
    async getRecord(context, recordId) {
      const record = await withRunAbort(context, () => services.records.find(context.userId, recordId));
      if (!record) throw new Error("Record not found or not accessible");
      return record;
    },
    listRecords: (context, input) => withRunAbort(context, () => services.records.list(context.userId, input.cursor, input.limit)),
    async searchRecords(context, input) {
      return { data: await withRunAbort(context, () => services.records.search(context.userId, input.query, input.limit)) };
    },
    async getMediaMetadata(context, mediaId) {
      const media = await withRunAbort(context, () => services.media.readyMetadata(context.userId, mediaId));
      if (!media) throw new Error("Media not found or not accessible");
      return media;
    },
    async listPreferences(context) { return { data: await withRunAbort(context, () => services.preferences.list(context.userId)) }; },
    async createPreference(context, input) {
      const result = await withRunAbort(context, () => services.preferences.create({ userId: context.userId, ...input }));
      if (result.kind === "limit_reached") throw new Error("Preference limit reached");
      return result;
    },
    async updatePreference(context, preferenceId, input) {
      const result = await withRunAbort(context, () => services.preferences.update({ userId: context.userId, preferenceId, ...input }));
      if (result.kind !== "ok") throw new Error(result.kind === "not_found" ? "Preference not found" : "Preference was changed by another request");
      return result.preference;
    },
    async deletePreference(context, preferenceId, expectedVersion) {
      const result = await withRunAbort(context, () => services.preferences.delete({ userId: context.userId, preferenceId, expectedVersion }));
      if (result.kind !== "ok") throw new Error(result.kind === "not_found" ? "Preference not found" : "Preference was changed by another request");
      return { preferenceId: result.preference.preferenceId };
    },
  };
}
