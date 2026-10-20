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
