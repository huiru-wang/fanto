import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { generateThumbnail, InvalidImageError, ThumbnailWork, thumbnailObjectKey } from "./image-thumbnail.js";
test("WebP fits width 600, rotates EXIF, strips metadata and never enlarges", async()=>{
 const data=await sharp({create:{width:100,height:1200,channels:3,background:"red"}}).jpeg().withMetadata({orientation:6}).toBuffer();
 const thumb=await generateThumbnail(data,"image/jpeg",10*1024*1024);
 assert.equal(thumb.originalWidth,1200); assert.equal(thumb.width,600); assert.equal(thumb.height,50);
 const meta=await sharp(thumb.data).metadata(); assert.equal(meta.format,"webp"); assert.equal(meta.exif,undefined);
 const small=await sharp({create:{width:32,height:24,channels:3,background:"white"}}).png().toBuffer();
 assert.equal((await generateThumbnail(small,"image/png",1024)).width,32);
 await assert.rejects(generateThumbnail(small,"image/jpeg",1024),InvalidImageError);
 await assert.rejects(generateThumbnail(Buffer.from("invalid"),"image/png",1024),InvalidImageError);
 assert.equal(thumbnailObjectKey("users/u/record/2026-10/id.jpg"),"users/u/record/2026-10/id.thumbnail-v1.webp");
});
test("single flight, queue bound and concurrency remain effective until operations finish", async()=>{
 const work=new ThumbnailWork();let active=0,max=0;const releases:Array<()=>void>=[];
 const operation=async()=>{active++;max=Math.max(max,active);await new Promise<void>(r=>releases.push(r));active--;return 1;};
 const first=work.run("same",operation);assert.equal(work.run("same",operation),first);
 const tasks=[first,...Array.from({length:9},(_,i)=>work.run(String(i),operation))];
 await assert.rejects(work.run("overflow",operation),/capacity/);
 for(let i=0;i<10;i++){await new Promise(r=>setImmediate(r)); releases.shift()!();}
 await Promise.all(tasks);assert.equal(max,2);assert.equal(await work.run("same",async()=>2),2);
});
