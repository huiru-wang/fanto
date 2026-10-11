import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import { AliyunStorage } from "./aliyun-storage.js";
const make = () => new AliyunStorage({ region: "oss-cn-hangzhou", bucket: "fanto-test", accessKeyId: "test", accessKeySecret: "test" });
test("signed URLs preserve plain keys, content type and actual expiry", async () => {
 const storage = make();
 const original = await storage.signRead("users/test/record/2026-10/test.jpg", 300);
 const thumbnail = await storage.signRead("users/test/record/2026-10/test.thumbnail-v1.webp", 300);
 assert.doesNotMatch(original.url + thumbnail.url, /x-oss-process/);
 assert.match(thumbnail.url, /test.thumbnail-v1.webp/);
 assert.equal(Date.parse(original.expiresAt), Number(new URL(original.url).searchParams.get("Expires")) * 1000);
 assert.match((await storage.signUpload("test.jpg", "image/jpeg", 900)).url, /Signature=/);
});
test("metadata normalization, bounded streams, safe errors and true missing objects", async () => {
 const storage = make();
 (storage as any).client = { head: async () => ({res:{headers:{"Content-Length":"4","Content-Type":"image/png",ETag:'"etag"',"x-oss-meta-source-etag":"source"}}}), getStream:async()=>({stream:Readable.from([Buffer.from("12345")])}) };
 assert.deepEqual(await storage.head("key"), {bytes:4,contentType:"image/png",etag:'"etag"',metadata:{"source-etag":"source"}});
 await assert.rejects(storage.getObject("key", {maxBytes:4}), {message:"ObjectTooLarge"});
 (storage as any).client.head = async()=>{throw Object.assign(new Error("secret"),{code:"NoSuchKey",status:404});};
 assert.equal(await storage.head("key"),null);
 (storage as any).client.head = async()=>{throw Object.assign(new Error("secret"),{code:"AccessDenied",status:403});};
 await assert.rejects(storage.head("key"), {message:"AccessDenied",status:403});
});
