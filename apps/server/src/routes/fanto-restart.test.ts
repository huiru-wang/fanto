import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../bootstrap/app.js";
import { FantoError, type FantoService } from "../domain/fanto/index.js";
const id="a1111111-1111-4111-8111-111111111111";
const headers={Authorization:"Bearer test","Content-Type":"application/json"};
const make=(restart:unknown)=>createApp({auth:{sessions: { verify:async()=>({userId:"owner"}) },assertActiveUser:async()=>{}} as never,
 fanto:{restart} as FantoService,records:{} as never,media:{} as never});
test("restart validates input and uses authenticated owner, never client supplied identity",async()=>{
 const calls:unknown[]=[];
 const app=make(async(userId:string,input:unknown)=>{calls.push([userId,input]);return {fantoId:id,sessionId:"new-session",version:2};});
 const body={fantoId:id,expectedVersion:1};
 const response=await app.request("/api/fanto/restart",{method:"POST",headers,body:JSON.stringify(body)});
 assert.equal(response.status,200);
 assert.equal((await response.json() as {result:{sessionId:string}}).result.sessionId,"new-session");
 assert.deepEqual(calls,[["owner",body]]);
 for(const input of [{...body,userId:"other"},{...body,expectedVersion:0},{...body,fantoId:"bad"}]){
  assert.equal((await app.request("/api/fanto/restart",{method:"POST",headers,body:JSON.stringify(input)})).status,400);
 }
 assert.equal(calls.length,1);
});
test("restart propagates busy, version and ownership refusals",async()=>{
 for(const [code,status] of [["FANTO_BUSY",409],["VERSION_CONFLICT",409],["NOT_FOUND",404]] as const){
  const app=make(async()=>{throw new FantoError(code,status);});
  const response=await app.request("/api/fanto/restart",{method:"POST",headers,body:JSON.stringify({fantoId:id,expectedVersion:1})});
  assert.equal(response.status,status);assert.equal((await response.json() as {errorCode:string}).errorCode,code);
 }
});
