import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "./config.js";
import { loadObjectStorageConfig } from "./object-storage-config.js";
import { createObjectStorage } from "./create-object-storage.js";
import { AliyunStorage } from "../infrastructure/clients/storage/aliyun-storage.js";
import { R2Storage } from "../infrastructure/clients/storage/r2-storage.js";
const aliyun = { OSS_BUCKET: "test", OSS_ACCESS_KEY_ID: "test", OSS_ACCESS_KEY_SECRET: "test" };
const r2 = { OBJECT_STORAGE_PROVIDER: "cloudflare-r2", R2_ENDPOINT: `https://${"a".repeat(32)}.r2.cloudflarestorage.com`, R2_BUCKET: "test", R2_ACCESS_KEY_ID: "test", R2_ACCESS_KEY_SECRET: "test" };
test("factory selects only the configured provider with independent credentials", () => {
 const oss=loadObjectStorageConfig(aliyun);assert.equal(oss.objectStorageProvider,"aliyun-oss");assert.ok(createObjectStorage(oss) instanceof AliyunStorage);
 const config=loadObjectStorageConfig({...r2,OSS_ENDPOINT:"bad-internal.example"});assert.ok(createObjectStorage(config) instanceof R2Storage);assert.equal("oss" in config,false);
 assert.equal(loadObjectStorageConfig({...aliyun,R2_ENDPOINT:"invalid"}).objectStorageProvider,"aliyun-oss");
 for(const key of ["R2_BUCKET","R2_ACCESS_KEY_ID","R2_ACCESS_KEY_SECRET"]) assert.throws(()=>loadObjectStorageConfig({...r2,[key]:""}),new RegExp(key));
 assert.throws(()=>loadObjectStorageConfig({OBJECT_STORAGE_PROVIDER:"unknown"}),/Unsupported/);
});
test("R2 accepts official account/jurisdiction S3 endpoints and rejects public or malformed endpoints",()=>{
 for(const suffix of ["",".eu",".us",".fedramp"])assert.equal(loadObjectStorageConfig({...r2,R2_ENDPOINT:`https://${"a".repeat(32)}${suffix}.r2.cloudflarestorage.com`}).objectStorageProvider,"cloudflare-r2");
 for(const endpoint of ["", "not a URL", r2.R2_ENDPOINT.replace("https:","http:"),"https://assets.example.com","https://test.r2.dev",r2.R2_ENDPOINT+"/bucket",r2.R2_ENDPOINT+"?token=private",r2.R2_ENDPOINT.replace("https://","https://private@")])assert.throws(()=>loadObjectStorageConfig({...r2,R2_ENDPOINT:endpoint}),/R2_ENDPOINT/);
 assert.throws(()=>loadObjectStorageConfig({...aliyun,OSS_ENDPOINT:"https://oss-internal.example"}),/publicly/);
});

test("full startup configuration keeps only selected storage settings",()=>{
 const previous=process.env;
 try {
  process.env={...previous,...r2,DATABASE_URL:"postgresql://test-only",AUTH_WEB_ORIGIN:"https://fanto.example",GOOGLE_ALLOWED_CLIENT_IDS:"test-only",APPLE_ALLOWED_CLIENT_IDS:"test-only",DEEPSEEK_API_KEY:"test-only",DASHSCOPE_EMBEDDING_DIMENSION:"768",DASHSCOPE_BASE_URL:"https://example.com",OSS_BUCKET:"",OSS_ACCESS_KEY_ID:"",OSS_ACCESS_KEY_SECRET:""};
  const config=loadConfig();assert.equal(config.objectStorageProvider,"cloudflare-r2");assert.equal("oss" in config,false);assert.ok(createObjectStorage(config) instanceof R2Storage);
  process.env={...process.env,...aliyun,OBJECT_STORAGE_PROVIDER:"aliyun-oss",OSS_ENDPOINT:"",R2_ENDPOINT:"invalid"};
  const oss=loadConfig();assert.equal(oss.objectStorageProvider,"aliyun-oss");assert.equal("r2" in oss,false);
 }finally{process.env=previous;}
});
