import assert from "node:assert/strict";
import test from "node:test";
import type { AgentBusinessServices, AgentRecord } from "../../business-services.js";
import { createRunContext } from "../run-context.js";
import { createContextProviders } from "./index.js";
import { createMemoryProvider, formatRecentRecord, truncateMemoryText } from "./memory.js";

function record(): AgentRecord {
  return {
    id: "record-123",
    userId: "user-1",
    source: "app",
    content: {
      text: "正文 ".repeat(200),
      blocks: [
        {
          type: "image",
          mediaId: "image-123",
          description: "图片描述 ".repeat(100),
        },
        {
          type: "audio",
          mediaId: "audio-123",
          durationMs: 12_000,
          transcription: "音频转写 ".repeat(100),
          asr: { status: "succeeded" },
        },
      ],
    },
    version: 1,
    status: "processed",
    extData: null,
    eventAt: "2026-09-29T05:00:00.000Z",
    createdAt: "2026-09-29T05:00:00.000Z",
    updatedAt: "2026-09-29T05:00:00.000Z",
  };
}

test("default context providers select recent memory in code", () => {
  const providers = createContextProviders({ fanto: {} as AgentBusinessServices });
  assert.ok(providers.some(provider => provider.slot === "recent_memory"));
  assert.ok(!providers.some(provider => provider.slot === "relevant_memory"));
});

test("recent memory mode reads only the cached top-10 record window", async () => {
  const calls: Array<{ limit: number; cursor?: string }> = [];
  let searchCalls = 0;
  const client: Pick<AgentBusinessServices, "listRecords" | "searchRecords"> = {
    async listRecords(_context, input) {
      calls.push(input);
      return {
        data: [record()],
        hasMore: false,
        nextCursor: null,
        pageSize: input.limit,
      };
    },
    async searchRecords() {
      searchCalls += 1;
      return { data: [] };
    },
  };
  const provider = createMemoryProvider({ mode: "recent", client });
  const context = createRunContext({
    runId: "run-1",
    userId: "user-1",
    query: "你好",
    slots: {},
    sessionId: "session-1",
    traceId: "trace-1",
    timeZone: "Asia/Shanghai",
    recentMessages: [],
  });

  const result = await provider.build(context);

  assert.equal(provider.slot, "recent_memory");
  assert.deepEqual(calls, [{ limit: 10 }]);
  assert.equal(searchCalls, 0);
  assert.equal(result.slot, "recent_memory");
  assert.match(result.content, /recordId: record-123/);
  assert.match(result.content, /mediaId=image-123/);
  assert.match(result.content, /mediaId=audio-123/);
  assert.match(result.content, /描述=/);
  assert.match(result.content, /转写=/);
});

test("recent memory formatting keeps ids intact and truncates long semantic text", () => {
  const formatted = formatRecentRecord(record(), "Asia/Shanghai");

  assert.match(formatted, /recordId: record-123/);
  assert.match(formatted, /mediaId=image-123/);
  assert.match(formatted, /mediaId=audio-123/);

  const contentLine = formatted.split("\n").find(line => line.startsWith("内容: "))!;
  const imageLine = formatted.split("\n").find(line => line.startsWith("- 图片: "))!;
  const audioLine = formatted.split("\n").find(line => line.startsWith("- 音频: "))!;

  assert.ok(contentLine.endsWith("…"));
  assert.ok(imageLine.endsWith("…"));
  assert.ok(audioLine.endsWith("…"));
  assert.equal(truncateMemoryText("x".repeat(301), 300), `${"x".repeat(300)}…`);
});
