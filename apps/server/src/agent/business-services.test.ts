import assert from "node:assert/strict";
import test from "node:test";
import { createAgentBusinessServices } from "./business-services.js";

test("Agent business services forward only the Run user to domain services", async () => {
  const calls: Array<{ method: string; userId: string }> = [];
  const services = createAgentBusinessServices({
    records: {
      find: async (userId: string) => { calls.push({ method: "find", userId }); return { id: "r1", status: "processed", content: { text: "record", blocks: [] } }; },
      list: async (userId: string) => { calls.push({ method: "list", userId }); return { data: [], hasMore: false, nextCursor: null, pageSize: 10 }; },
      search: async (userId: string) => { calls.push({ method: "search", userId }); return []; },
    } as never,
    media: { readyMetadata: async (userId: string) => { calls.push({ method: "media", userId }); return { mediaId: "m1", mediaType: "image", mimeType: "image/jpeg" }; } } as never,
    tasks: {} as never,
    webSearch: { search: async () => ({ query: "q", summary: "s", sources: [] }) } as never,
    resolveTaskAgent: () => undefined,
  });
  const context = { userId: "user-from-run" };
  await services.getRecord(context, "r1");
  await services.listRecords(context, { limit: 10 });
  await services.searchRecords(context, { query: "record", limit: 10 });
  await services.getMediaMetadata(context, "m1");
  assert.deepEqual(calls, [
    { method: "find", userId: "user-from-run" },
    { method: "list", userId: "user-from-run" },
    { method: "search", userId: "user-from-run" },
    { method: "media", userId: "user-from-run" },
  ]);
});
