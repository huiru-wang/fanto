import type {FantoSettings,FantoService} from "../domain/fanto/index.js";
import type {MediaService} from "../domain/media/index.js";
import type {RecordService} from "../domain/records/index.js";
import {type Memory,type MemorySearchResult,type MemoryService} from "../domain/memory/index.js";
export type AgentRequestContext={userId:string;traceId?:string;signal?:AbortSignal;sessionId?:string;sourceMessageId?:string;timeZone?:string};
export type AgentRecord=NonNullable<Awaited<ReturnType<RecordService["find"]>>>;
export type AgentRecordList=Awaited<ReturnType<RecordService["list"]>>;
export type AgentRecordSearch={data:Awaited<ReturnType<RecordService["search"]>>};
export type AgentMediaMetadata=NonNullable<Awaited<ReturnType<MediaService["readyMetadata"]>>>;
export type AgentMemory=Omit<Memory,"fantoId">;
export type AgentMemorySearch=Omit<MemorySearchResult,"fantoId">;
export type AgentBusinessServices={
 getFantoConversationSettings(context:AgentRequestContext):Promise<FantoSettings|null>;
 reserveMainRun(context:AgentRequestContext,reserve:()=>Promise<()=>void>|(()=>void)):Promise<()=>void>;
 getDefaultMainSession(context:AgentRequestContext):Promise<{sessionId:string;agentId:string;scopeKey:string}>;
 readRecords(context:AgentRequestContext,input:{recordIds?:string[];query?:string}):Promise<AgentRecord[]>;
 listRecords(context:AgentRequestContext,input:{limit:number;cursor?:string}):Promise<AgentRecordList>;
 searchRecords(context:AgentRequestContext,input:{query:string;limit:number}):Promise<AgentRecordSearch>;
 getMediaMetadata(context:AgentRequestContext,mediaId:string):Promise<AgentMediaMetadata>;
 listMemories(context:AgentRequestContext,input?:{}):Promise<AgentMemory[]>;
 searchMemories(context:AgentRequestContext,input:{query:string;limit:number}):Promise<AgentMemorySearch[]>;
 createMemory(context:AgentRequestContext,input:{content:string}):Promise<AgentMemory>;
 updateMemory(context:AgentRequestContext,memoryId:string,input:{content:string}):Promise<AgentMemory>;
 deleteMemory(context:AgentRequestContext,memoryId:string):Promise<void>;
};
async function guarded<T>(ctx:AgentRequestContext,fn:()=>Promise<T>){ctx.signal?.throwIfAborted();const r=await fn();ctx.signal?.throwIfAborted();return r;}
const strip=(m:Memory):AgentMemory=>{const {fantoId:_a,...rest}=m;return rest;};
const stripSearch=(m:MemorySearchResult):AgentMemorySearch=>{const {fantoId:_a,...rest}=m;return rest;};
export function createAgentBusinessServices(services:{records:RecordService;media:MediaService;memories:MemoryService;fanto?:FantoService}):AgentBusinessServices{
 const fanto=()=>{if(!services.fanto)throw new Error("FantoService is required");return services.fanto;};
 const configuration=async(ctx:AgentRequestContext)=>ctx.sessionId?fanto().getForSession(ctx.userId,ctx.sessionId):null;
 const owner=async(ctx:AgentRequestContext):Promise<string>=>{
  if(!ctx.sessionId)throw new Error("SESSION_REQUIRED");
  const current=await configuration(ctx);
  if(!current)throw new Error("FANTO_REQUIRED");
  if(!current.agentConfig.fantoMemoryEnabled)throw new Error("FANTO_MEMORY_NOT_AUTHORIZED");
  return current.fantoId;
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
  async listMemories(ctx){return (await guarded(ctx,async()=>services.memories.list(await owner(ctx)))).map(strip);},
  async searchMemories(ctx,input){return (await guarded(ctx,async()=>services.memories.search(await owner(ctx),input.query,input.limit))).map(stripSearch);},
  async createMemory(ctx,input){return strip(await guarded(ctx,async()=>services.memories.create(await owner(ctx),input)));},
  async updateMemory(ctx,id,input){
   const value=await guarded(ctx,async()=>services.memories.update(await owner(ctx),id,input));
   if(!value)throw new Error("Memory unavailable");return strip(value);
  },
  async deleteMemory(ctx,id){
   const deleted=await guarded(ctx,async()=>services.memories.remove(await owner(ctx),id));
   if(!deleted)throw new Error("Memory unavailable");
  },
 };
}
