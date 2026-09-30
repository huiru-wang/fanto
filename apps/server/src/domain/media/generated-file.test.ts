import assert from "node:assert/strict";
import test from "node:test";
import { metadata } from "./media-service.js";

test("file media metadata exposes filename and bytes", () => {
  assert.deepEqual(metadata({
    mediaId: "m1",
    userId: "u1",
    objectKey: "users/u1/media/m1/result.md",
    mediaType: "file",
    mimeType: "text/markdown",
    bytes: 12,
    status: "ready",
    extData: { filename: "result.md" },
    createdAt: "2026-09-29T00:00:00.000Z",
    updatedAt: "2026-09-29T00:00:00.000Z",
  }), {
    mediaId: "m1",
    mediaType: "file",
    mimeType: "text/markdown",
    bytes: 12,
    filename: "result.md",
  });
});
