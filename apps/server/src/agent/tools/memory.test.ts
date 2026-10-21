import assert from "node:assert/strict";
import test from "node:test";
import type {AgentBusinessServices,AgentMemory} from "../business-services.js";
import {createRunContext} from "../context/run-context.js";
import {createFantoMemoryTool} from "./memory.js";
const context=()=>createRunContext({runId:"run",userId:"owner",sessionId:"session",sourceMessageId:"message",query:"hi",slots:{},recentMessages:[]});
const row:AgentMemory={memoryId:"memory",content:"我认识霄汉",createdAt:"2026-10-17",updatedAt:"2026-10-17"};
test("single memory tool searches, creates and updates without kind or owner inputs",async()=>{
 const calls:string[]=[];
 const client={
  async searchMemories(request,input){assert.equal(request.userId,"owner");assert.equal(request.sourceMessageId,"message");assert.deepEqual(input,{query:"霄汉",limit:5});calls.push("search");return [{...row,distance:0.1}];},
  async createMemory(_request,input){assert.deepEqual(input,{content:"我遇见了霄汉"});calls.push("create");return {...row,...input};},
  async updateMemory(_request,id,input){assert.equal(id,"memory");assert.deepEqual(input,{content:"我与霄汉已经熟悉"});calls.push("update");return {...row,...input};},
 } satisfies Partial<AgentBusinessServices>;
 const tool=createFantoMemoryTool(client as AgentBusinessServices);
 const invoke=(params:Parameters<typeof tool.execute>[1])=>tool.execute("call",params,()=>{},{} as never,{} as never,context());
 await invoke({action:"search",query:" 霄汉 "});
 await invoke({action:"create",content:"我遇见了霄汉"});
 const updated=await invoke({action:"update",memoryId:"memory",content:"我与霄汉已经熟悉"});
 assert.match(JSON.stringify(updated.details),/已经熟悉/);
 assert.deepEqual(calls,["search","create","update"]);
 await assert.rejects(invoke({action:"create",kind:"shared_history",content:"不允许类型"}),/does not accept kind/);
 await assert.rejects(invoke({action:"create",ownerId:"foreign",content:"不允许越权"}),/does not accept ownerId/);
 assert.doesNotMatch(JSON.stringify(tool.parameters),/"kind"|"ownerId"|"userId"/);
});
test("failed writes are propagated",async()=>{
 const tool=createFantoMemoryTool({createMemory:async()=>{throw Error("embedding unavailable");}} as unknown as AgentBusinessServices);
 await assert.rejects(tool.execute("call",{action:"create",content:"我认识霄汉"},()=>{},{} as never,{} as never,context()),/embedding unavailable/);
});
