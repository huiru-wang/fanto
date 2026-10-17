import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { loadEnv } from "../../../bootstrap/config.js";
import { loadObjectStorageConfig } from "../../../bootstrap/object-storage-config.js";
import { createObjectStorage } from "../../../bootstrap/create-object-storage.js";

// Opt-in: uses a real bucket; writes only a fresh random prefix and deletes it.
test("real R2: signed direct upload/read, metadata, bounded download and cleanup",{skip:process.env.R2_SMOKE_TEST!=="1"},async()=>{
 loadEnv();
 const config=loadObjectStorageConfig({...process.env,OBJECT_STORAGE_PROVIDER:"cloudflare-r2"});
 const storage=createObjectStorage(config),prefix=`smoke/r2/${randomUUID()}`;
 const original=`${prefix}/original.png`,thumbnail=`${prefix}/original.thumbnail-v1.webp`;
 try {
  const data=await sharp({create:{width:32,height:24,channels:3,background:"white"}}).png().toBuffer();
  const ticket=await storage.signUpload(original,"image/png",900);
  const put=await fetch(ticket.url,{method:"PUT",headers:{"Content-Type":"image/png"},body:new Uint8Array(data),signal:AbortSignal.timeout(15_000)});assert.equal(put.ok,true);
  const head=await storage.head(original);assert.ok(head);assert.equal(head.bytes,data.length);assert.equal(head.contentType,"image/png");
  assert.deepEqual(await storage.getObject(original,{maxBytes:data.length}),data);
  await assert.rejects(storage.getObject(original,{maxBytes:1}),{message:"ObjectTooLarge"});
  const small=await sharp(data).webp({quality:80}).toBuffer();await storage.putObject(thumbnail,small,"image/webp",{metadata:{"source-etag":head.etag,"thumbnail-version":"1"}});
  assert.equal((await storage.head(thumbnail))!.metadata["source-etag"],head.etag);
  const read=await storage.signRead(thumbnail,300);const response=await fetch(read.url,{signal:AbortSignal.timeout(15_000)});assert.equal(response.ok,true);assert.deepEqual(Buffer.from(await response.arrayBuffer()),small);
  assert.equal(await storage.head(`${prefix}/missing`),null);await storage.remove(`${prefix}/missing`);
 }finally{
  await Promise.all([original,thumbnail].map(async key=>{await storage.remove(key);assert.equal(await storage.head(key),null);}));
 }
});
