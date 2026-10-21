import assert from "node:assert/strict";
import test from "node:test";
import {createAgentBusinessServices} from "./business-services.js";
import {defaultAgentConfig,emptyRole,type FantoSettings} from "../domain/fanto/model.js";

test("business memory is always scoped to the Fanto of the trusted user+session",async()=>{
 const role=(fantoId:string):FantoSettings=>({fantoId,userId:"owner",sessionId:"s",nickname:fantoId,description:"",avatarMediaId:null,
 roleConfig:emptyRole(),agentConfig:defaultAgentConfig(),status:"active",archivedAt:null,version:1,createdAt:"now",updatedAt:"now"});
 let current:FantoSettings|null=role("one");const reads:string[]=[],writes:string[]=[];
 const services=createAgentBusinessServices({
  fanto:{getForSession:async(userId:string)=>{if(userId!=="owner")throw Error("NOT_FOUND");return current;},defaultSession:async()=>({sessionId:"s",scopeKey:"one",agentId:"main"})} as never,
  records:{list:async()=>({data:[]}),search:async()=>[],findMany:async()=>[]} as never,
  media:{readyRecordMetadata:async()=>({mediaId:"m"})} as never,
  memories:{list:async(id:string)=>{reads.push(id);return [];},create:async(id:string,input:{content:string})=>{writes.push(id);return {fantoId:id,memoryId:"m",...input,createdAt:"now",updatedAt:"now"};}} as never,
 });
 const ctx={userId:"owner",sessionId:"s"};
 await services.listMemories(ctx);assert.deepEqual(reads,["one"]);
 await services.createMemory(ctx,{content:"我记住了一个称呼"});assert.deepEqual(writes,["one"]);
 current=role("two");await services.listMemories(ctx);assert.equal(reads.at(-1),"two");
 current.agentConfig.fantoMemoryEnabled=false;
 await assert.rejects(services.listMemories(ctx),/NOT_AUTHORIZED/);
 await assert.rejects(services.createMemory(ctx,{content:"不能写"}),/NOT_AUTHORIZED/);
 await assert.rejects(services.listMemories({userId:"other",sessionId:"s"}),/NOT_FOUND/);
 current=null;await assert.rejects(services.listMemories(ctx),/FANTO_REQUIRED/);
});

test("Agent business services forward only the Run user to domain services", async () => {
  const calls: Array<{ method: string; userId: string }> = [];
  const services = createAgentBusinessServices({
    records: {
      findMany: async (userId: string) => { calls.push({ method: "findMany", userId }); return [{ id: "r1", status: "processed", content: { text: "record", blocks: [] } }]; },
      list: async (userId: string) => { calls.push({ method: "list", userId }); return { data: [], hasMore: false, nextCursor: null, pageSize: 10 }; },
      search: async (userId: string) => { calls.push({ method: "search", userId }); return []; },
    } as never,
    media: { readyRecordMetadata: async (userId: string) => { calls.push({ method: "media", userId }); return { mediaId: "m1", mediaType: "image", mimeType: "image/jpeg" }; } } as never,
    memories: {} as never,
  });
  const context = { userId: "user-from-run" };
  await services.readRecords(context, { recordIds: ["r1"] });
  await services.listRecords(context, { limit: 10 });
  await services.searchRecords(context, { query: "record", limit: 10 });
  await services.getMediaMetadata(context, "m1");
  assert.deepEqual(calls, [
    { method: "findMany", userId: "user-from-run" },
    { method: "list", userId: "user-from-run" },
    { method: "search", userId: "user-from-run" },
    { method: "media", userId: "user-from-run" },
  ]);
});
