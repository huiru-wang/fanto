import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { R2Storage } from "./r2-storage.js";
import { MediaService } from "../../../domain/media/media-service.js";
import type { PostgresMediaRepository, MediaAsset } from "../../../domain/media/postgres-repository.js";
import type { Thumbnail } from "../../../domain/media/image-thumbnail.js";

test("real S3 SDK transport completes the unchanged media flow, including thumbnail retry and project copies",async()=>{
 const objects=new Map<string,{data:Buffer;type:string;etag:string;metadata:Record<string,string>}>();let failThumbnail=true,thumbnailAttempts=0;const writes:string[]=[];
 const server=createServer(async(req,res)=>{
  try {
   const url=new URL(req.url!,"http://localhost"),key=decodeURIComponent(url.pathname).replace(/^\/bucket\//,"");
   assert.ok(req.headers.authorization?.startsWith("AWS4-HMAC-SHA256")||url.searchParams.has("X-Amz-Signature"));
   assert.equal(req.headers["x-amz-checksum-crc32"],undefined);assert.equal(req.headers["x-amz-sdk-checksum-algorithm"],undefined);
   if(req.method==="PUT"){
    if(key.endsWith("thumbnail-v1.webp"))thumbnailAttempts++;
    if(key.endsWith("thumbnail-v1.webp")&&failThumbnail){res.writeHead(503,{"Content-Type":"application/xml"});res.end("<Error><Code>ServiceUnavailable</Code><Message>private</Message></Error>");return;}
    const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const data=Buffer.concat(chunks);
    const metadata=Object.fromEntries(Object.entries(req.headers).filter(([name])=>name.startsWith("x-amz-meta-")).map(([name,value])=>[name.slice(11),String(value)]));
    const etag='"'+createHash("md5").update(data).digest("hex")+'"';objects.set(key,{data,type:String(req.headers["content-type"]),etag,metadata});writes.push(key);res.writeHead(200,{ETag:etag});res.end();return;
   }
   if(req.method==="DELETE"){objects.delete(key);res.writeHead(204);res.end();return;}
   const object=objects.get(key);
   if(!object){res.writeHead(404,{"Content-Type":"application/xml"});res.end("<Error><Code>NoSuchKey</Code></Error>");return;}
   res.writeHead(200,{"Content-Type":object.type,"Content-Length":String(object.data.length),ETag:object.etag,...Object.fromEntries(Object.entries(object.metadata).map(([name,value])=>["x-amz-meta-"+name,value]))});
   res.end(req.method==="HEAD"?undefined:object.data);
  }catch{res.writeHead(500);res.end();}
 });
 await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
 const address=server.address();assert.ok(address&&typeof address!=="string");
 const storage=new R2Storage({endpoint:`http://127.0.0.1:${address.port}`,bucket:"bucket",accessKeyId:"test-only",accessKeySecret:"test-only"});
 const assets=new Map<string,MediaAsset>();
 const repo={create:async(input:any)=>{const row={...input,status:"uploading" as const,extData:{recordId:null},createdAt:"",updatedAt:""};assets.set(input.mediaId,row);return row;},
 findMedia:async(id:string,userId:string)=>{const row=assets.get(id);return row?.userId===userId?row:null;},
 findMediaByIds:async(ids:string[],userId:string)=>ids.flatMap(id=>{const row=assets.get(id);return row?.userId===userId?[row]:[];}),
 complete:async(id:string,_userId:string,capture:any,thumbnail:Thumbnail)=>{const row=assets.get(id)!;row.status="ready";row.extData={...row.extData,capture,variants:{thumbnail}};return row;},
 createReadyAsset:async(input:any)=>{const row={...input,status:"ready" as const,createdAt:"",updatedAt:""};assets.set(input.mediaId,row);return row;}};
 const media=new MediaService(repo as unknown as PostgresMediaRepository,storage);
 try {
  const data=await sharp({create:{width:1200,height:800,channels:3,background:"blue"}}).png().toBuffer();
  const ticket=(await media.createUpload("owner",{mimeType:"image/png",bytes:data.length}))!;
  const put=await fetch(ticket.uploadUrl,{method:"PUT",headers:{"Content-Type":"image/png"},body:new Uint8Array(data)});assert.equal(put.ok,true);
  assert.equal((await media.completeUpload("owner",ticket.mediaId,{})).kind,"incomplete");assert.equal(assets.get(ticket.mediaId)!.status,"uploading");assert.equal(writes.length,1);assert.equal(thumbnailAttempts,1);
  failThumbnail=false;assert.equal((await media.completeUpload("owner",ticket.mediaId,{})).kind,"ok");
  const count=writes.length;assert.equal((await media.completeUpload("owner",ticket.mediaId,{})).kind,"ok");assert.equal(writes.length,count);
  const small=(await media.readUrl("owner",ticket.mediaId,"thumbnail"))!;const thumb=Buffer.from(await(await fetch(small.url)).arrayBuffer());assert.equal((await sharp(thumb).metadata()).width,600);
  const original=(await media.readUrl("owner",ticket.mediaId,"original"))!;assert.deepEqual(Buffer.from(await(await fetch(original.url)).arrayBuffer()),data);
  const row=assets.get(ticket.mediaId)!;const thumbnail=(row.extData.variants as {thumbnail:Thumbnail}).thumbnail;
  assert.equal((await storage.head(thumbnail.objectKey))!.metadata["source-etag"],(await storage.head(row.objectKey))!.etag);
  assert.equal(await media.readUrl("foreign",ticket.mediaId,"thumbnail"),null);
  const copied:string[]=[];const mapping=await media.copyFinalReferences("owner","project",[ticket.mediaId],{} as never,copied);assert.equal(copied.length,2);
  await media.deleteRecordObjects([row.objectKey,thumbnail.objectKey]);assert.equal(await storage.head(row.objectKey),null);
  assert.ok(await media.readUrl("owner",mapping[ticket.mediaId]!,"thumbnail"));assert.equal((await storage.head(copied[1]!))!.contentType,"image/webp");
  await media.cleanupUncommittedProjectObjects(copied);assert.equal(objects.size,0);await storage.remove("already-missing");
 }finally{server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
