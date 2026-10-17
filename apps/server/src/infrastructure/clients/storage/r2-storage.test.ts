import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test, { after } from "node:test";
import { PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
const dir=mkdtempSync(join(tmpdir(),"fanto-r2-log-"));process.env.LOG_DIR=dir;
const {R2Storage}=await import("./r2-storage.js");
after(()=>rmSync(dir,{recursive:true,force:true}));
const make=()=>new R2Storage({endpoint:`https://${"a".repeat(32)}.r2.cloudflarestorage.com`,bucket:"test.bucket",accessKeyId:"private-key",accessKeySecret:"private-secret"});
const mock=(storage:InstanceType<typeof R2Storage>,send:(command:any,options:any)=>Promise<any>)=>{(storage as any).client.send=send;};
test("real SDK signs exact key/type with no checksum headers, exact TTL and auto region",async()=>{
 const storage=make(),key="users/u/record/2026-10/图 &+.jpg";
 const ticket=await storage.signUpload(key,"image/jpeg",900),url=new URL(ticket.url);
 assert.equal(decodeURIComponent(url.pathname),`/test.bucket/${key}`);
 assert.equal(url.searchParams.get("X-Amz-Expires"),"900");
 assert.equal(url.searchParams.get("X-Amz-SignedHeaders"),"content-type;host");
 assert.match(url.searchParams.get("X-Amz-Credential")!,/\/auto\/s3\/aws4_request$/);
 assert.doesNotMatch(ticket.url,/checksum|x-oss-process|Content-MD5/i);
 const date=url.searchParams.get("X-Amz-Date")!.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,"$1-$2-$3T$4:$5:$6Z");
 assert.equal(Date.parse(ticket.expiresAt),Date.parse(date)+900_000);
 const read=new URL((await storage.signRead(key,300)).url);assert.equal(read.searchParams.get("X-Amz-SignedHeaders"),"host");assert.equal(read.searchParams.get("X-Amz-Expires"),"300");
 for(const expiry of [0,-1,1.5,604801])await assert.rejects(storage.signRead(key,expiry),{message:"InvalidSignatureExpiry"});
});
test("PUT/HEAD/GET/DELETE obey storage contract and normalized metadata",async()=>{
 const storage=make();const commands:any[]=[];
 mock(storage,async(command,options)=>{commands.push(command);assert.ok(options.abortSignal);if(command instanceof HeadObjectCommand)return {ContentLength:4,ContentType:"image/webp",ETag:'"opaque"',Metadata:{"Source-ETag":'"source"'},$metadata:{httpStatusCode:200}};if(command instanceof GetObjectCommand)return {Body:Readable.from([Buffer.from("1234")]),ContentLength:4,$metadata:{httpStatusCode:200}};return {$metadata:{httpStatusCode:200}};});
 await storage.putObject("private-object",Buffer.from("1234"),"image/webp",{metadata:{"source-etag":'"source"'}});
 assert.deepEqual(await storage.head("private-object"),{bytes:4,contentType:"image/webp",etag:'"opaque"',metadata:{"source-etag":'"source"'}});
 assert.equal((await storage.getObject("private-object",{maxBytes:4})).toString(),"1234");await storage.remove("private-object");
 assert.ok(commands[0] instanceof PutObjectCommand);assert.equal(commands[0].input.Bucket,"test.bucket");assert.deepEqual(commands[0].input.Metadata,{"source-etag":'"source"'});assert.ok(commands[3] instanceof DeleteObjectCommand);
});
test("bounded GET destroys oversized or failed streams; deadline covers the response body",async t=>{
 const storage=make();
 for(const length of [undefined,100]){
  const body=Readable.from([Buffer.from("12345")]);mock(storage,async()=>({Body:body,ContentLength:length,$metadata:{}}));
  await assert.rejects(storage.getObject("private-object",{maxBytes:4}),{message:"ObjectTooLarge"});assert.equal(body.destroyed,true);
 }
 mock(storage,async()=>({Body:undefined,$metadata:{}}));await assert.rejects(storage.getObject("private-object"),{message:"InvalidObjectBody"});
 const broken=new Readable({read(){this.destroy(new Error("private response body"));}});
 mock(storage,async()=>({Body:broken,$metadata:{}}));await assert.rejects(storage.getObject("private-object"),{message:"StorageUnavailable"});assert.equal(broken.destroyed,true);
 const body=new Readable({read(){}});mock(storage,async()=>({Body:body,$metadata:{}}));
 t.mock.timers.enable({apis:["setTimeout"]});
 const request=storage.getObject("private-object");await new Promise(resolve=>setImmediate(resolve));
 const rejected=assert.rejects(request,{message:"StorageTimeout"});t.mock.timers.tick(15_000);await rejected;assert.equal(body.destroyed,true);t.mock.timers.reset();
});
test("only missing objects are null/idempotent; all other failures are safe and logged",async()=>{
 const storage=make();
 const fail=(name:string,status:number)=>mock(storage,async()=>{throw Object.assign(new Error("private-secret https://private.example/?token=private"),{name,$metadata:{httpStatusCode:status}});});
 for(const name of ["NotFound","NoSuchKey"]){fail(name,404);assert.equal(await storage.head("private-object"),null);await storage.remove("private-object");}
 for(const [name,status] of [["AccessDenied",403],["NoSuchBucket",404],["InternalError",500]] as const){fail(name,status);await assert.rejects(storage.head("private-object"),{message:name,status});await assert.rejects(storage.remove("private-object"),{message:name,status});}
 mock(storage,async()=>({ContentLength:4,ContentType:"image/png",$metadata:{}}));await assert.rejects(storage.head("private-object"),{message:"InvalidObjectMetadata"});
 const logs=readFileSync(join(dir,"service.log"),"utf8");assert.match(logs,/cloudflare-r2/);assert.match(logs,/durationMs/);assert.match(logs,/AccessDenied/);assert.doesNotMatch(logs,/private|https:/);
});
