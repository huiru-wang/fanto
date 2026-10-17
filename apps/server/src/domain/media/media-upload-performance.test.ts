import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { MediaService } from "./media-service.js";
import type { PostgresMediaRepository, MediaAsset } from "./postgres-repository.js";
import { MemoryStorage } from "./testing/memory-storage.js";

test("completing an image reuses the validated original HEAD instead of requesting it twice", async () => {
  const storage = new MemoryStorage();
  let row: MediaAsset | null = null;
  const media = {
    create: async (input: MediaAsset) => {
      row = { ...input, status: "uploading", extData: { recordId: null }, createdAt: "", updatedAt: "" };
      return row;
    },
    findMedia: async () => row,
    complete: async (_id: string, _userId: string, capture: object, thumbnail: object) => {
      row = { ...row!, status: "ready", extData: { ...row!.extData, capture, variants: { thumbnail } } };
      return row;
    },
  };
  const service = new MediaService(media as unknown as PostgresMediaRepository, storage);
  const source = await sharp({ create: { width: 800, height: 600, channels: 3, background: "blue" } }).png().toBuffer();
  const ticket = (await service.createUpload("owner", { mimeType: "image/png", bytes: source.length }))!;
  const original = row!.objectKey;
  await storage.putObject(original, source, "image/png");

  const heads: string[] = [];
  const head = storage.head.bind(storage);
  storage.head = async key => { heads.push(key); return head(key); };
  assert.equal((await service.completeUpload("owner", ticket.mediaId, {})).kind, "ok");
  assert.deepEqual(heads, [original, original.replace(/\.png$/, ".thumbnail-v1.webp")]);
});
