import assert from "node:assert/strict";
import test from "node:test";
import { uploadDraft, type UploadProgress } from "../src/api/media-upload.js";
for (const failed of ["create","put","complete"] as const) test(`no automatic retry after ${failed}; next user action resumes`,async()=>{
 const media:{upload?:UploadProgress}={};const calls:string[]=[];let fail=true;
 const ticket={mediaId:"id",uploadUrl:"https://test",expiresAt:new Date(Date.now()+900_000).toISOString()};
 const driver={create:async()=>{calls.push("create");if(fail&&failed==="create")throw Error("failed");return ticket;},
 put:async()=>{calls.push("put");if(fail&&failed==="put")throw Error("lost response");return {ok:true,status:200};},
 complete:async()=>{calls.push("complete");if(fail&&failed==="complete")throw Error("failed");},isMissing:()=>false};
 await assert.rejects(uploadDraft(media,driver));const count=calls.length;await new Promise(r=>setImmediate(r));assert.equal(calls.length,count);
 fail=false;assert.equal(await uploadDraft(media,driver),"id");
 assert.equal(calls.filter(c=>c==="create").length,failed==="create"?2:1);
 assert.equal(calls.filter(c=>c==="put").length,1);
 const readyCount=calls.length;assert.equal(await uploadDraft(media,driver),"id");assert.equal(calls.length,readyCount);
});
test("only explicit missing object on user retry triggers another PUT",async()=>{
 const ticket={mediaId:"id",uploadUrl:"https://test",expiresAt:new Date(Date.now()+900_000).toISOString()};
 const media:{upload?:UploadProgress}={upload:{ticket,stage:"uploading"}};const calls:string[]=[];
 let first=true;
 assert.equal(await uploadDraft(media,{create:async()=>{throw Error("unexpected");},put:async()=>{calls.push("put");return {ok:true,status:200};},complete:async()=>{calls.push("complete");if(first){first=false;throw Error("missing");}},isMissing:e=>e instanceof Error&&e.message==="missing"}),"id");
 assert.deepEqual(calls,["complete","put","complete"]);
});
