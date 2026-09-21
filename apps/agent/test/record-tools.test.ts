import assert from "node:assert/strict";
import test from "node:test";
import { TODO_CONTEXT } from "@earendil-works/pi-agent-core";
import {
  buildRecordPreview,
  createRecordGetTool,
  createRecordListTool,
  createRecordSearchTool,
} from "../src/tools/record-tools.js";
import { createRunContext } from "../src/harness/run-context.js";
import { ToolRegistry } from "../src/tools/registry.js";

const baseRecord = {
  id: "r1",
  userId: "u1",
  source: "home",
  content: {
    text: "准备周末徒步",
    blocks: [
      { type: "image" as const, mediaId: "img1", description: "雨衣放在玄关。" },
      { type: "audio" as const, mediaId: "audio1", transcription: "周六去西山。" },
    ],
  },
  version: 1,
  status: "processed" as const,
  eventAt: "2026-09-18T00:00:00.000Z",
  createdAt: "2026-09-18T00:00:00.000Z",
  updatedAt: "2026-09-18T00:00:00.000Z",
  media: [{ mediaId: "img1", url: "https://signed.example/secret" }],
};

async function execute(tool: any, params: unknown, context = createRunContext({ userId: "u1", traceId: "trace-1" })) {
  return tool.execute("call-1", params, () => {}, {} as never, {} as never, context);
}

test("record tool schemas never expose user identity and cap list/search limits at 20", () => {
  const client = { getRecord: async () => baseRecord, listRecords: async () => ({ data: [], hasMore: false, nextCursor: null, pageSize: 10 }), searchRecords: async () => ({ data: [] }) };
  const getTool = createRecordGetTool(client as any);
  const listTool = createRecordListTool(client as any);
  const searchTool = createRecordSearchTool(client as any);
  for (const tool of [getTool, listTool, searchTool]) {
    assert.doesNotMatch(JSON.stringify(tool.parameters), /userId|traceId|taskId/);
  }
  assert.match(JSON.stringify(listTool.parameters), /"maximum":20/);
  assert.match(JSON.stringify(searchTool.parameters), /"maximum":20/);
});

test("record_get uses current Run Context identity and strips media projection", async () => {
  const calls: any[] = [];
  const client = {
    getRecord: async (ctx: unknown, recordId: string) => { calls.push({ ctx, recordId }); return baseRecord; },
    listRecords: async () => ({ data: [], hasMore: false, nextCursor: null, pageSize: 10 }),
    searchRecords: async () => ({ data: [] }),
  };
  const result = await execute(createRecordGetTool(client as any), { recordId: "r1" });
  assert.deepEqual(calls, [{
    ctx: { userId: "u1", traceId: "trace-1", signal: undefined },
    recordId: "r1",
  }]);
  assert.deepEqual(result.details, {
    recordId: "r1",
    eventAt: baseRecord.eventAt,
    source: "home",
    status: "processed",
    content: baseRecord.content,
  });
  assert.doesNotMatch(result.content[0]?.type === "text" ? result.content[0].text : "", /signed\.example|"media":/);
});

test("record_get fails closed without run user context", async () => {
  const client = {
    getRecord: async () => baseRecord,
    listRecords: async () => ({ data: [], hasMore: false, nextCursor: null, pageSize: 10 }),
    searchRecords: async () => ({ data: [] }),
  };
  await assert.rejects(() => execute(createRecordGetTool(client as any), { recordId: "r1" }, TODO_CONTEXT), /missing user context/);
});

test("record_list defaults to 10, forwards cursor, and returns compact previews", async () => {
  const calls: any[] = [];
  const longRecord = {
    ...baseRecord,
    id: "r2",
    content: { text: "x".repeat(600), blocks: [] },
  };
  const client = {
    getRecord: async () => baseRecord,
    listRecords: async (ctx: unknown, input: unknown) => {
      calls.push({ ctx, input });
      return { data: [baseRecord, longRecord], hasMore: true, nextCursor: "next", pageSize: 10 };
    },
    searchRecords: async () => ({ data: [] }),
  };
  const result = await execute(createRecordListTool(client as any), { cursor: "cursor-1" });
  assert.deepEqual(calls[0].input, { limit: 10, cursor: "cursor-1" });
  assert.equal(result.details.data[0].preview, "准备周末徒步\n图片描述：雨衣放在玄关。\n音频转写：周六去西山。");
  assert.equal(result.details.data[1].preview.length, 500);
  assert.match(result.details.data[1].preview, /…$/);
  assert.equal(result.details.hasMore, true);
  assert.equal(result.details.nextCursor, "next");
});

test("buildRecordPreview preserves text and media understanding in block order", () => {
  assert.equal(
    buildRecordPreview(baseRecord as any),
    "准备周末徒步\n图片描述：雨衣放在玄关。\n音频转写：周六去西山。",
  );
});

test("record_search returns atomic source metadata and distance", async () => {
  const calls: any[] = [];
  const client = {
    getRecord: async () => baseRecord,
    listRecords: async () => ({ data: [], hasMore: false, nextCursor: null, pageSize: 10 }),
    searchRecords: async (ctx: unknown, input: unknown) => {
      calls.push({ ctx, input });
      return { data: [{ recordId: "r1", sourceType: "image", mediaId: "img1", snippet: "图片描述：AI Coding", distance: 0.18, eventAt: "2026-09-18T00:00:00.000Z" }] };
    },
  };
  const result = await execute(createRecordSearchTool(client as any), { query: "  AI Coding  " });
  assert.deepEqual(calls[0].input, { query: "AI Coding", limit: 10 });
  assert.deepEqual(result.details, { data: [{
    recordId: "r1",
    sourceType: "image",
    mediaId: "img1",
    snippet: "图片描述：AI Coding",
    distance: 0.18,
    eventAt: "2026-09-18T00:00:00.000Z",
  }] });
  assert.doesNotMatch(JSON.stringify(result.details), /userId/);
});

test("record_search rejects whitespace-only query before HTTP", async () => {
  let called = false;
  const client = {
    getRecord: async () => baseRecord,
    listRecords: async () => ({ data: [], hasMore: false, nextCursor: null, pageSize: 10 }),
    searchRecords: async () => { called = true; return { data: [] }; },
  };
  await assert.rejects(() => execute(createRecordSearchTool(client as any), { query: "   " }), /must not be empty/);
  assert.equal(called, false);
});

test("ToolRegistry creates only explicitly declared Record tools", () => {
  const client = {
    getRecord: async () => baseRecord,
    listRecords: async () => ({ data: [], hasMore: false, nextCursor: null, pageSize: 10 }),
    searchRecords: async () => ({ data: [] }),
    getMediaMetadata: async () => ({ mediaId: "img1", mediaType: "image", mimeType: "image/jpeg" }),
  };
  const registry = new ToolRegistry(client as any);
  assert.deepEqual(
    registry.create(["record_list", "record_search", "present_media"] as any, "/tmp").map(tool => tool.name),
    ["record_list", "record_search", "present_media"],
  );
  assert.deepEqual(new ToolRegistry().create(["read", "write", "edit", "bash"] as any, "/tmp").map(tool => tool.name), ["read", "write", "edit", "bash"]);
  assert.throws(() => new ToolRegistry().create(["record_get"] as any, "/tmp"), /FantoServerClient is required/);
});
