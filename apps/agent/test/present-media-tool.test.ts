import assert from "node:assert/strict";
import test from "node:test";
import { TODO_CONTEXT } from "@earendil-works/pi-agent-core";
import { createRunContext } from "../src/harness/run-context.js";
import {
  createPresentMediaTool,
  sanitizePresentMediaDetails,
} from "../src/tools/present-media-tool.js";

async function execute(tool: any, params: unknown, context = createRunContext({ userId: "u1", traceId: "trace-1" })) {
  return tool.execute("call-1", params, () => {}, {} as never, {} as never, context);
}

test("present_media exposes only mediaIds in its schema", () => {
  const tool = createPresentMediaTool({ getMediaMetadata: async () => ({ mediaId: "m1", mediaType: "image", mimeType: "image/jpeg" }) } as any);
  const schema = JSON.stringify(tool.parameters);
  assert.match(schema, /mediaIds/);
  assert.match(schema, /"minItems":1/);
  assert.match(schema, /"maxItems":20/);
  assert.doesNotMatch(schema, /mediaType|mimeType|width|height|durationMs|userId|url/);
});

test("present_media validates media through the current Run Context and keeps display order", async () => {
  const calls: Array<{ userId: string; traceId?: string; mediaId: string }> = [];
  const client = {
    getMediaMetadata: async (ctx: { userId: string; traceId?: string }, mediaId: string) => {
      calls.push({ userId: ctx.userId, traceId: ctx.traceId, mediaId });
      return mediaId === "image-1"
        ? { mediaId, mediaType: "image" as const, mimeType: "image/jpeg", width: 1200, height: 800 }
        : { mediaId, mediaType: "audio" as const, mimeType: "audio/mp4", durationMs: 18_300 };
    },
  };
  const result = await execute(createPresentMediaTool(client as any), {
    mediaIds: [" image-1 ", "audio-1", "image-1"],
  });

  assert.deepEqual(calls, [
    { userId: "u1", traceId: "trace-1", mediaId: "image-1" },
    { userId: "u1", traceId: "trace-1", mediaId: "audio-1" },
  ]);
  assert.deepEqual(result.details, {
    items: [
      { mediaId: "image-1", mediaType: "image", mimeType: "image/jpeg", width: 1200, height: 800 },
      { mediaId: "audio-1", mediaType: "audio", mimeType: "audio/mp4", durationMs: 18_300 },
    ],
  });
  assert.doesNotMatch(JSON.stringify(result), /https?:\/\//);
});

test("present_media fails closed without Run Context identity", async () => {
  const tool = createPresentMediaTool({ getMediaMetadata: async () => ({ mediaId: "m1", mediaType: "image", mimeType: "image/jpeg" }) } as any);
  await assert.rejects(() => execute(tool, { mediaIds: ["m1"] }, TODO_CONTEXT), /missing user context/);
});

test("sanitized present_media details strip unknown fields and reject invalid media", () => {
  assert.deepEqual(sanitizePresentMediaDetails({
    items: [{
      mediaId: "m1",
      mediaType: "image",
      mimeType: "image/jpeg",
      width: 100,
      secret: "do-not-expose",
    }],
  }), {
    items: [{ mediaId: "m1", mediaType: "image", mimeType: "image/jpeg", width: 100 }],
  });
  assert.equal(sanitizePresentMediaDetails({
    items: [{ mediaId: "m1", mediaType: "video", mimeType: "video/mp4" }],
  }), undefined);
});
