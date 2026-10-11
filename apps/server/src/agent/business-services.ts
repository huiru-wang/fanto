import type { CreativeService } from "../domain/projects/creative-service.js";
import type { CreativeContext, ImageInput, ProjectManageInput } from "../domain/projects/creative-model.js";
import type { CreateProposalInput } from "../domain/projects/index.js";
import type { MediaService } from "../domain/media/index.js";
import type { RecordService } from "../domain/records/index.js";
import type { Memory, MemoryKind, MemorySearchResult, MemoryService } from "../domain/memory/index.js";

export type AgentRequestContext = {
  userId: string;
  projectId?: string;
  recordId?: string;
  recordVersion?: number;
  traceId?: string;
  signal?: AbortSignal;
  sessionId?: string;
  sourceMessageId?: string;
  timeZone?: string;
};
export type AgentRecord = NonNullable<Awaited<ReturnType<RecordService["find"]>>>;
export type AgentRecordList = Awaited<ReturnType<RecordService["list"]>>;
export type AgentRecordSearch = { data: Awaited<ReturnType<RecordService["search"]>> };
export type AgentMediaMetadata = NonNullable<Awaited<ReturnType<MediaService["readyMetadata"]>>>;
export type AgentMemory = Omit<Memory, "userId">;
export type AgentMemorySearch = Omit<MemorySearchResult, "userId">;

export type AgentBusinessServices = {
  creativeContext?(context: AgentRequestContext): ReturnType<CreativeService["context"]>;
  readProject?(context: AgentRequestContext, input: Parameters<CreativeService["readProject"]>[1]): ReturnType<CreativeService["readProject"]>;
  createProposal?(context: AgentRequestContext, input: CreateProposalInput): ReturnType<CreativeService["createProposal"]>;
  generateImage?(context: AgentRequestContext, input: ImageInput): ReturnType<CreativeService["generateImage"]>;
  reviewImage?(context: AgentRequestContext, input: {mediaId: string; brief: string; referenceMediaIds?: string[]}): ReturnType<CreativeService["reviewImage"]>;
  manageProject?(context: AgentRequestContext, input: ProjectManageInput): ReturnType<CreativeService["projectManage"]>;
  readRecords(context: AgentRequestContext, input: { recordIds?: string[]; query?: string }): Promise<AgentRecord[]>;
  listRecords(context: AgentRequestContext, input: { limit: number; cursor?: string }): Promise<AgentRecordList>;
  searchRecords(context: AgentRequestContext, input: { query: string; limit: number }): Promise<AgentRecordSearch>;
  getMediaMetadata(context: AgentRequestContext, mediaId: string): Promise<AgentMediaMetadata>;
  listMemories(context: AgentRequestContext, input?: { kind?: MemoryKind }): Promise<AgentMemory[]>;
  searchMemories(context: AgentRequestContext, input: { query: string; limit: number }): Promise<AgentMemorySearch[]>;
  createMemory(context: AgentRequestContext, input: { kind: MemoryKind; content: string }): Promise<AgentMemory>;
  updateMemory(context: AgentRequestContext, memoryId: string, input: { kind: MemoryKind; content: string }): Promise<AgentMemory>;
  deleteMemory(context: AgentRequestContext, memoryId: string): Promise<void>;
};

async function withRunAbort<T>(context: AgentRequestContext, operation: () => Promise<T>): Promise<T> {
  context.signal?.throwIfAborted();
  const result = await operation();
  context.signal?.throwIfAborted();
  return result;
}

export function createAgentBusinessServices(services: {
  records: RecordService;
  creative?: CreativeService;
  media: MediaService;
  memories: MemoryService;
}): AgentBusinessServices {
  const creative = () => { if (!services.creative) throw new Error("CREATIVE_AGENT_DISABLED"); return services.creative; };
  return {
    creativeContext: context => creative().context(context),
    readProject: (context, input) => creative().readProject(context, input),
    createProposal: (context, input) => creative().createProposal(context, input),
    generateImage: (context, input) => creative().generateImage(context, input),
    reviewImage: (context, input) => creative().reviewImage(context, input),
    manageProject: (context, input) => creative().projectManage(context, input),
    async readRecords(context, input) {
      if (context.recordId || context.projectId) return withRunAbort(context, () => creative().readRecords(context, input));
      const recordIds = input.recordIds
        ?? (await withRunAbort(context, () => services.records.search(context.userId, input.query!, 3))).map(result => result.recordId);
      return withRunAbort(context, () => services.records.findMany(context.userId, recordIds));
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
    async listMemories(context, input = {}) {
      const memories = await withRunAbort(context, () => services.memories.list(context.userId, input));
      return memories.map(({ userId: _userId, ...memory }) => memory);
    },
    async searchMemories(context, input) {
      const memories = await withRunAbort(context, () => services.memories.search(context.userId, input.query, input.limit));
      return memories.map(({ userId: _userId, ...memory }) => memory);
    },
    async createMemory(context, input) {
      const memory = await withRunAbort(context, () => services.memories.create(context.userId, input));
      const { userId: _userId, ...result } = memory;
      return result;
    },
    async updateMemory(context, memoryId, input) {
      const memory = await withRunAbort(context, () => services.memories.update(context.userId, memoryId, input));
      if (!memory) throw new Error("Memory not found or not accessible");
      const { userId: _userId, ...result } = memory;
      return result;
    },
    async deleteMemory(context, memoryId) {
      const deleted = await withRunAbort(context, () => services.memories.remove(context.userId, memoryId));
      if (!deleted) throw new Error("Memory not found or not accessible");
    },
  };
}
