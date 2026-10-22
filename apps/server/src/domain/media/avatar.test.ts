import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { MediaService } from "./media-service.js";
import type { MediaAsset, PostgresMediaRepository } from "./postgres-repository.js";
import { MemoryStorage } from "./testing/memory-storage.js";
import { createApp } from "../../bootstrap/app.js";
for (const purpose of ["fanto_avatar", "user_avatar"] as const) test(`${purpose} completion stores one cropped image with both display variants using the same object`, async () => {
    const storage = new MemoryStorage();
    let row: MediaAsset | undefined;
    const repo = { create: async (i: any) => row = { ...i, extData: { purpose: i.purpose }, status: "uploading", createdAt: "", updatedAt: "" }, findMedia: async (id: string, user: string) => row?.mediaId === id && row?.userId === user ? row : null, complete: async (_id: string, _user: string, capture: any) => row = { ...row!, status: "ready", extData: { ...row!.extData, capture } }, saveThumbnail: async () => { throw new Error("avatar must not generate thumbnails"); } };
    const service = new MediaService(repo as unknown as PostgresMediaRepository, storage);
    const image = await sharp({ create: { width: 512, height: 512, channels: 3, background: "blue" } }).jpeg().toBuffer();
    const ticket = await service.createUpload("owner", { purpose, mimeType: "image/jpeg", bytes: image.length });
    assert.ok(ticket);
    assert.ok(row!.objectKey.startsWith(purpose === "user_avatar" ? "users/owner/profile/avatar/" : "users/owner/fanto/avatar/"));
    await storage.putObject(row!.objectKey, image, "image/jpeg");
    const writes = storage.writes.length;
    assert.equal((await service.completeUpload("owner", ticket.mediaId, { width: 1, height: 1 })).kind, "ok");
    assert.equal(storage.writes.length, writes);
    assert.equal(row!.extData.variants, undefined);
    assert.deepEqual(row!.extData.capture, { width: 512, height: 512 });
    assert.equal((await service.readUrl("owner", ticket.mediaId, "thumbnail"))?.url, (await service.readUrl("owner", ticket.mediaId, "original"))?.url);
    assert.equal(await service.readUrl("other", ticket.mediaId), null);
    assert.equal(await service.readyMetadata("owner", ticket.mediaId), null);
    assert.equal(await service.createUpload("owner", { purpose, mimeType: "audio/mp4", bytes: 100 }), null);
    assert.equal(await service.createUpload("owner", { purpose, mimeType: "image/jpeg", bytes: 512 * 1024 + 1 }), null);
    const bad = await sharp({ create: { width: 200, height: 180, channels: 3, background: "red" } }).jpeg().toBuffer();
    const wrong = await service.createUpload("owner", { purpose, mimeType: "image/jpeg", bytes: bad.length });
    await storage.putObject(row!.objectKey, bad, "image/jpeg");
    assert.equal((await service.completeUpload("owner", wrong!.mediaId, {})).kind, "invalid_avatar");
});


test("profile cover validates aspect ratio and signs one isolated image", async () => {
  const storage = new MemoryStorage();
  let row: MediaAsset | undefined;
  const repo = {
    create: async (i: any) => row = {...i, extData: {purpose: i.purpose}, status: "uploading", createdAt: "", updatedAt: ""},
    findMedia: async (id: string, user: string) => row?.mediaId === id && row?.userId === user ? row : null,
    complete: async (_id: string, _user: string, capture: any) => row = {...row!, status: "ready", extData: {...row!.extData, capture}},
    saveThumbnail: async () => { throw new Error("cover must not generate a second image"); },
  };
  const service = new MediaService(repo as unknown as PostgresMediaRepository, storage);
  const image = await sharp({create: {width: 1600, height: 1200, channels: 3, background: "cyan"}}).jpeg().toBuffer();
  const app = createApp({records: {} as never, media: service,
    auth: {sessions: { verify: async (userId: string) => ({userId}) }, assertActiveUser: async () => {}} as never});
  const headers = {Authorization: "Bearer owner", "Content-Type": "application/json"};
  const uploadResponse = await app.request("/api/uploads", {method: "POST", headers,
    body: JSON.stringify({purpose: "user_cover", mimeType: "image/jpeg", bytes: image.length})});
  assert.equal(uploadResponse.status, 201);
  const ticket = (await uploadResponse.json() as {result: {mediaId: string}}).result;
  assert.ok(ticket.mediaId);
  assert.ok(row!.objectKey.startsWith("users/owner/profile/cover/"));
  await storage.putObject(row!.objectKey, image, "image/jpeg");
  const writes = storage.writes.length;
  const completeResponse = await app.request(`/api/uploads/${ticket.mediaId}/complete`, {method: "POST", headers,
    body: JSON.stringify({capture: {width: 1600, height: 1200}})});
  assert.equal(completeResponse.status, 200);
  assert.equal((await completeResponse.json() as {result: {status: string}}).result.status, "ready");
  assert.equal(storage.writes.length, writes);
  assert.equal((await service.readUrl("owner", ticket.mediaId, "thumbnail"))?.url, (await service.readUrl("owner", ticket.mediaId))?.url);
  assert.equal(await service.readUrl("other", ticket.mediaId), null);
  assert.equal(await service.readyMetadata("owner", ticket.mediaId), null);
  assert.equal(await service.createUpload("owner", {purpose: "user_cover", mimeType: "audio/mp4", bytes: 100}), null);
  assert.equal(await service.createUpload("owner", {purpose: "user_cover", mimeType: "image/jpeg", bytes: 2 * 1024 * 1024 + 1}), null);
  const square = await sharp({create: {width: 640, height: 640, channels: 3, background: "blue"}}).jpeg().toBuffer();
  const wrong = await service.createUpload("owner", {purpose: "user_cover", mimeType: "image/jpeg", bytes: square.length});
  await storage.putObject(row!.objectKey, square, "image/jpeg");
  assert.equal((await service.completeUpload("owner", wrong!.mediaId, {})).kind, "invalid_avatar");
});
