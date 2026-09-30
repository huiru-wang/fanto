import assert from "node:assert/strict";
import test from "node:test";
import { mediaMime, mediaObjectKey, normalizeMimeType, taskObjectKey } from "./mime.js";

test("media MIME mapping derives the canonical type and object extension", () => {
  assert.deepEqual(mediaMime("audio/mp4"), { mimeType: "audio/mp4", mediaType: "audio", extension: ".m4a" });
  assert.deepEqual(mediaMime("audio/mpeg; charset=binary"), { mimeType: "audio/mpeg", mediaType: "audio", extension: ".mp3" });
  assert.deepEqual(mediaMime("audio/wav"), { mimeType: "audio/wav", mediaType: "audio", extension: ".wav" });
  assert.deepEqual(mediaMime("image/jpeg"), { mimeType: "image/jpeg", mediaType: "image", extension: ".jpg" });
  assert.deepEqual(mediaMime("image/png"), { mimeType: "image/png", mediaType: "image", extension: ".png" });
  assert.deepEqual(mediaMime("image/webp"), { mimeType: "image/webp", mediaType: "image", extension: ".webp" });
  assert.equal(mediaMime("audio/aac"), null);
  assert.equal(normalizeMimeType(" Audio/MPEG; charset=binary "), "audio/mpeg");
  const createdAt = new Date("2026-09-30T01:02:03.000Z");
  assert.equal(mediaObjectKey("u", "media-id", ".mp3", createdAt), "users/u/media/2026-09/media-id.mp3");
  assert.equal(taskObjectKey("u", "session-id", "result.html", createdAt), "users/u/task/2026-09/session-id/result.html");
});
