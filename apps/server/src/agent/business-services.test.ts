import assert from "node:assert/strict";
import test from "node:test";
import { createAgentBusinessServices } from "./business-services.js";
import {defaultAgentConfig,emptyRole,type FantoSettings} from "../domain/fanto/model.js";

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

test("business boundary denies disabled capabilities and binds Fanto memory to the owned Session",async()=>{
  let current:FantoSettings|null={fantoId:"one",userId:"owner",sessionId:"s",nickname:"",description:"",avatarMediaId:null,
    roleConfig:emptyRole(),agentConfig:defaultAgentConfig(),status:"active",archivedAt:null,version:1,createdAt:"now",updatedAt:"now"};
  const owners:unknown[]=[],writes:unknown[]=[];
  const services=createAgentBusinessServices({
    fanto:{getForSession:async(userId:string)=>{if(userId!=="owner")throw Error("NOT_FOUND");return current;}} as never,
    records:{list:async()=>({data:[]}),search:async()=>[],findMany:async()=>[]} as never,
    media:{readyRecordMetadata:async()=>({mediaId:"m"})} as never,
    memories:{list:async(owner:unknown)=>{owners.push(owner);return [];},create:async(owner:unknown)=>{writes.push(owner);return {};} } as never,
  });
  const ctx={userId:"owner",sessionId:"s"};
  for(const read of [()=>services.readRecords(ctx,{recordIds:["r"]}),()=>services.listRecords(ctx,{limit:1}),
    ()=>services.searchRecords(ctx,{query:"q",limit:1}),()=>services.getMediaMetadata(ctx,"m")])await assert.rejects(read(),/NOT_AUTHORIZED/);
  await assert.rejects(services.listMemories(ctx),/NOT_AUTHORIZED/);
  await services.listMemories(ctx,{},"fanto");assert.deepEqual(owners.pop(),{ownerType:"fanto",ownerId:"one"});
  current.agentConfig.userMemoryEnabled=true;
  await services.listMemories(ctx);assert.deepEqual(owners.pop(),{ownerType:"user",ownerId:"owner"});
  await assert.rejects(services.createMemory(ctx,{kind:"current_focus",content:"x"}),/NOT_AUTHORIZED/);assert.equal(writes.length,0);
  current={...current,fantoId:"two"};await services.listMemories(ctx,{},"fanto");assert.deepEqual(owners.pop(),{ownerType:"fanto",ownerId:"two"});
  await assert.rejects(services.listMemories({userId:"other",sessionId:"s"},{},"fanto"),/NOT_FOUND/);
  current=null;
  await assert.rejects(services.listMemories(ctx,{},"fanto"),/FANTO_REQUIRED/);
  await services.createMemory(ctx,{kind:"current_focus",content:"x"});assert.deepEqual(writes.pop(),{ownerType:"user",ownerId:"owner"});
});
