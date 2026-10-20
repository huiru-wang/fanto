import type {FantoSettings,FantoService} from "../domain/fanto/index.js";
import type {MediaService} from "../domain/media/index.js";
import type {RecordService} from "../domain/records/index.js";
import {type Memory,type MemoryKind,type MemorySearchResult,type MemoryService} from "../domain/memory/index.js";
import {fantoOwner,userOwner,type MemoryOwner} from "../domain/memory/model.js";
export type AgentRequestContext={userId:string;traceId?:string;signal?:AbortSignal;sessionId?:string;sourceMessageId?:string;timeZone?:string};
export type AgentRecord=NonNullable<Awaited<ReturnType<RecordService["find"]>>>;
export type AgentRecordList=Awaited<ReturnType<RecordService["list"]>>;
export type AgentRecordSearch={data:Awaited<ReturnType<RecordService["search"]>>};
export type AgentMediaMetadata=NonNullable<Awaited<ReturnType<MediaService["readyMetadata"]>>>;
export type AgentMemory=Omit<Memory,"ownerType"|"ownerId">;
export type AgentMemorySearch=Omit<MemorySearchResult,"ownerType"|"ownerId">;
export type MemoryToolScope="user"|"fanto";
export type AgentBusinessServices={
 getFantoConversationSettings(context:AgentRequestContext):Promise<FantoSettings|null>;
 reserveMainRun(context:AgentRequestContext,reserve:()=>Promise<()=>void>|(()=>void)):Promise<()=>void>;
 getDefaultMainSession(context:AgentRequestContext):Promise<{sessionId:string;agentId:string;scopeKey:string}>;
 readRecords(context:AgentRequestContext,input:{recordIds?:string[];query?:string}):Promise<AgentRecord[]>;
 listRecords(context:AgentRequestContext,input:{limit:number;cursor?:string}):Promise<AgentRecordList>;
 searchRecords(context:AgentRequestContext,input:{query:string;limit:number}):Promise<AgentRecordSearch>;
 getMediaMetadata(context:AgentRequestContext,mediaId:string):Promise<AgentMediaMetadata>;
 listMemories(context:AgentRequestContext,input?:{kind?:MemoryKind},scope?:MemoryToolScope):Promise<AgentMemory[]>;
 searchMemories(context:AgentRequestContext,input:{query:string;limit:number;kinds?:readonly MemoryKind[]},scope?:MemoryToolScope):Promise<AgentMemorySearch[]>;
 createMemory(context:AgentRequestContext,input:{kind:MemoryKind;content:string},scope?:MemoryToolScope):Promise<AgentMemory>;
 updateMemory(context:AgentRequestContext,memoryId:string,input:{kind:MemoryKind;content:string},scope?:MemoryToolScope):Promise<AgentMemory>;
 deleteMemory(context:AgentRequestContext,memoryId:string,scope?:MemoryToolScope):Promise<void>;
};
async function guarded<T>(ctx:AgentRequestContext,fn:()=>Promise<T>){ctx.signal?.throwIfAborted();const r=await fn();ctx.signal?.throwIfAborted();return r;}
const strip=(m:Memory):AgentMemory=>{const {ownerType:_a,ownerId:_b,...rest}=m;return rest;};
const stripSearch=(m:MemorySearchResult):AgentMemorySearch=>{const {ownerType:_a,ownerId:_b,...rest}=m;return rest;};
export function createAgentBusinessServices(services:{records:RecordService;media:MediaService;memories:MemoryService;fanto?:FantoService}):AgentBusinessServices{
 const fanto=()=>{if(!services.fanto)throw new Error("FantoService is required");return services.fanto;};
 const configuration=async(ctx:AgentRequestContext)=>ctx.sessionId?fanto().getForSession(ctx.userId,ctx.sessionId):null;
 const owner=async(ctx:AgentRequestContext,scope:MemoryToolScope,write:boolean):Promise<MemoryOwner>=>{
   if(!ctx.sessionId)throw new Error("SESSION_REQUIRED");
   const current=await configuration(ctx);
   if(scope==="fanto"){
    if(!current)throw new Error("FANTO_REQUIRED");
    return fantoOwner(current.fantoId);
   }
   if(current&&(!current.agentConfig.userMemoryEnabled||write))throw new Error("USER_MEMORY_NOT_AUTHORIZED");
   return userOwner(ctx.userId);
 };
 return {
  getFantoConversationSettings:ctx=>guarded(ctx,()=>configuration(ctx)),
  reserveMainRun:(ctx,reserve)=>fanto().reserveRun(ctx.userId,ctx.sessionId!,reserve),
  getDefaultMainSession:ctx=>guarded(ctx,()=>fanto().defaultSession(ctx.userId)),
  async readRecords(ctx,input){
   const c=await configuration(ctx);
   if(c&&!c.agentConfig.recordReadEnabled)throw new Error("RECORD_READ_NOT_AUTHORIZED");
   const ids=input.recordIds??(await guarded(ctx,()=>services.records.search(ctx.userId,input.query!,3))).map(x=>x.recordId);
   return guarded(ctx,()=>services.records.findMany(ctx.userId,ids));
  },
  async listRecords(ctx,input){
   const c=await configuration(ctx);
   if(c&&!c.agentConfig.recordReadEnabled)throw new Error("RECORD_READ_NOT_AUTHORIZED");
   return guarded(ctx,()=>services.records.list(ctx.userId,input.cursor,input.limit));
  },
  async searchRecords(ctx,input){
   const c=await configuration(ctx);
   if(c&&!c.agentConfig.recordReadEnabled)throw new Error("RECORD_READ_NOT_AUTHORIZED");
   return {data:await guarded(ctx,()=>services.records.search(ctx.userId,input.query,input.limit))};
  },
  async getMediaMetadata(ctx,id){
   const c=await configuration(ctx);
   // present_media needs a separately validated record provenance; it cannot bypass disabled record access.
   if(c&&!c.agentConfig.recordReadEnabled)throw new Error("RECORD_MEDIA_NOT_AUTHORIZED");
   const m=await guarded(ctx,()=>services.media.readyRecordMetadata(ctx.userId,id));
   if(!m)throw new Error("Media unavailable");return m;
  },
  async listMemories(ctx,input={},scope="user"){return (await guarded(ctx,async()=>services.memories.list(await owner(ctx,scope,false),input))).map(strip);},
  async searchMemories(ctx,input,scope="user"){return (await guarded(ctx,async()=>services.memories.search(await owner(ctx,scope,false),input.query,input.limit,input.kinds))).map(stripSearch);},
  async createMemory(ctx,input,scope="user"){return strip(await guarded(ctx,async()=>services.memories.create(await owner(ctx,scope,true),input)));},
  async updateMemory(ctx,id,input,scope="user"){
   const value=await guarded(ctx,async()=>services.memories.update(await owner(ctx,scope,true),id,input));
   if(!value)throw new Error("Memory unavailable");return strip(value);
  },
  async deleteMemory(ctx,id,scope="user"){
   const deleted=await guarded(ctx,async()=>services.memories.remove(await owner(ctx,scope,true),id));
   if(!deleted)throw new Error("Memory unavailable");
  },
 };
}
