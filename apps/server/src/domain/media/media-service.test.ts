import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { MediaService } from "./media-service.js";
import type { PostgresMediaRepository, MediaAsset } from "./postgres-repository.js";
import type { Thumbnail } from "./image-thumbnail.js";
import { MemoryStorage } from "./testing/memory-storage.js";
test("completion requires thumbnail; user retry resumes; read variants and isolation are provider independent",async()=>{
 const storage=new MemoryStorage();let row:MediaAsset|null=null;let failCommit=false;
 const repo={create:async(input:any)=>row={...input,status:"uploading",extData:{recordId:null},createdAt:"",updatedAt:""},
 findMedia:async(id:string,user:string)=>row?.mediaId===id&&row.userId===user?row:null,
 complete:async(_id:string,_user:string,capture:any,thumbnail:Thumbnail)=>{if(failCommit)throw new Error("DB unavailable");row={...row!,status:"ready",extData:{...row!.extData,capture,variants:{thumbnail}}};return row;},
 saveThumbnail:async(_id:string,_user:string,thumbnail:Thumbnail)=>{row={...row!,extData:{...row!.extData,variants:{thumbnail}}};return row;}};
 const service=new MediaService(repo as unknown as PostgresMediaRepository,storage);
 const png=await sharp({create:{width:1000,height:800,channels:3,background:"red"}}).png().toBuffer();
 const ticket=(await service.createUpload("owner",{mimeType:"image/png",bytes:png.length}))!;
 const key=row!.objectKey;assert.match(key,/users\/owner\/record\/\d{4}-\d{2}\//);
 assert.equal((await service.completeUpload("owner",ticket.mediaId,{})).kind,"not_uploaded");
 await storage.putObject(key,png,"image/png"); storage.failThumbnail=true;
 assert.equal((await service.completeUpload("owner",ticket.mediaId,{})).kind,"incomplete"); assert.equal(row!.status,"uploading");
 storage.failThumbnail=false;failCommit=true;
 assert.equal((await service.completeUpload("owner",ticket.mediaId,{})).kind,"incomplete");
 const writes=storage.writes.length;failCommit=false;
 assert.equal((await service.completeUpload("owner",ticket.mediaId,{width:1})).kind,"ok");assert.equal(storage.writes.length,writes);
 assert.deepEqual(row!.extData.capture,{width:1000,height:800});assert.equal(row!.extData.recordId,null);
 assert.equal((await service.completeUpload("owner",ticket.mediaId,{})).kind,"ok");
 assert.equal(await service.readUrl("other",ticket.mediaId,"thumbnail"),null);
 assert.match((await service.readUrl("owner",ticket.mediaId,"thumbnail"))!.url,/thumbnail-v1.webp$/);
 assert.match((await service.readUrl("owner",ticket.mediaId,"original"))!.url,/\.png$/);
 row!.extData={recordId:"record"}; await service.readUrl("owner",ticket.mediaId,"thumbnail");assert.equal(row!.extData.recordId,"record");
});

test("generation signs stored thumbnails in input order without reading originals; review keeps originals", async () => {
  const storage = new MemoryStorage();
  const rows: MediaAsset[] = ["a", "b"].map(mediaId => ({
    mediaId, userId: "owner", status: "ready", mediaType: "image", mimeType: "image/png", bytes: 100,
    objectKey: `users/owner/record/2026-10/${mediaId}.png`, createdAt: "", updatedAt: "",
    extData: { variants: { thumbnail: { version: 1, objectKey: `users/owner/record/2026-10/${mediaId}.thumbnail-v1.webp`,
      mimeType: "image/webp", bytes: 50, width: 600, height: 480, sourceEtag: "source" } } },
  }));
  const service = new MediaService({findMediaByIds: async (ids: string[], user: string) => rows.filter(row => row.userId === user && ids.includes(row.mediaId))} as unknown as PostgresMediaRepository, storage);
  const signed: Array<{key: string; seconds: number}> = [];
  const signRead = storage.signRead.bind(storage);
  storage.signRead = async (key, seconds) => { signed.push({key, seconds}); return signRead(key, seconds); };
  const reads: string[] = [];
  const getObject = storage.getObject.bind(storage);
  storage.getObject = async (key, options) => { reads.push(key); return getObject(key, options); };
  const expected = [rows[1], rows[0]].map(row => row.objectKey.replace(".png", ".thumbnail-v1.webp"));
  const result = await service.withGenerationReferences("owner", ["b", "a"], "project", async urls => {
    assert.deepEqual(urls, expected.map(key => `https://storage.test/${key}`)); return "generated";
  }, "thumbnail");
  assert.equal(result, "generated");
  assert.deepEqual(signed, expected.map(key => ({key, seconds: 900})));
  assert.deepEqual(reads, []);
  assert.deepEqual(storage.writes, []);
  await assert.rejects(service.withGenerationReferences("other", ["a"], "project", async () => assert.fail("model must not run"), "thumbnail"), /SOURCE_MEDIA_UNAVAILABLE/);
  assert.equal(signed.length, 2);
  const png = await sharp({create: {width: 1000, height: 800, channels: 3, background: "red"}}).png().toBuffer();
  await storage.putObject(rows[0].objectKey, png, "image/png");
  let temporaryKey = "";
  await assert.rejects(service.withGenerationReferences("owner", ["a"], "project", async urls => {
    temporaryKey = urls[0].replace("https://storage.test/", "");
    assert.match(temporaryKey, /\/temp\/.*\.jpg$/);
    assert.equal((await sharp(await storage.getObject(temporaryKey)).metadata()).format, "jpeg");
    throw new Error("review failed");
  }), /review failed/);
  assert.equal(reads[0], rows[0].objectKey);
  assert.equal(storage.objects.has(temporaryKey), false);
});

test("generation backfills missing thumbnail and never falls back to original on failure", async () => {
  const storage = new MemoryStorage();
  const png = await sharp({create: {width: 1000, height: 800, channels: 3, background: "blue"}}).png().toBuffer();
  let row: MediaAsset = {mediaId: "a", userId: "owner", status: "ready", mediaType: "image", mimeType: "image/png", bytes: png.length,
    objectKey: "users/owner/record/2026-10/a.png", extData: {recordId: "record"}, createdAt: "", updatedAt: ""};
  const service = new MediaService({
    findMediaByIds: async () => [row],
    saveThumbnail: async (_id: string, _user: string, thumbnail: Thumbnail) => row = {...row, extData: {...row.extData, variants: {thumbnail}}},
  } as unknown as PostgresMediaRepository, storage);
  await storage.putObject(row.objectKey, png, "image/png");
  storage.failThumbnail = true;
  await assert.rejects(service.withGenerationReferences("owner", ["a"], "project", async () => assert.fail("model must not run"), "thumbnail"), /temporary failure/);
  storage.failThumbnail = false;
  await service.withGenerationReferences("owner", ["a"], "project", async urls => {
    assert.match(urls[0], /a\.thumbnail-v1\.webp$/);
    const thumbnail = await sharp(await storage.getObject(urls[0].replace("https://storage.test/", ""))).metadata();
    assert.equal(thumbnail.width, 600);
    assert.equal(thumbnail.format, "webp");
  }, "thumbnail");
  assert.equal(row.extData.recordId, "record");
  assert.equal(storage.writes.length, 2);
});
