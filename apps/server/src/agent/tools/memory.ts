import {Type} from "typebox";
import type {Context} from "@earendil-works/pi-agent-core";
import type {AgentBusinessServices,AgentMemory,AgentMemorySearch,MemoryToolScope} from "../business-services.js";
import {createRunContext} from "../context/index.js";
import type {FantoTool} from "./types.js";
import {userMemoryKinds,fantoMemoryKinds,type MemoryKind} from "../../domain/memory/model.js";
const actions=Type.Union(["list","search","create","update","delete"].map(x=>Type.Literal(x)) as [ReturnType<typeof Type.Literal>,...ReturnType<typeof Type.Literal>[]]);
function toolSchema(scope:MemoryToolScope,readOnly=false){
 const kinds=scope==="user"?userMemoryKinds:fantoMemoryKinds;
 return Type.Object({
  action:readOnly?Type.Union([Type.Literal("list"),Type.Literal("search")]):actions,memoryId:Type.Optional(Type.String({minLength:1})),
  kind:Type.Optional(Type.Union(kinds.map(x=>Type.Literal(x)) as [ReturnType<typeof Type.Literal>,...ReturnType<typeof Type.Literal>[]])),
  content:Type.Optional(Type.String({minLength:1,maxLength:1000})),
  query:Type.Optional(Type.String({minLength:1,maxLength:1000})),
  limit:Type.Optional(Type.Integer({minimum:1,maximum:10}))
 },{additionalProperties:false});
}
type Details={action:string;memories?:AgentMemory[]|AgentMemorySearch[];memory?:AgentMemory;memoryId?:string};
function runContext(context:Context){
 const r=createRunContext.read(context);
 return {userId:r.userId,sessionId:r.sessionId,signal:context.abortSignal,traceId:r.traceId,sourceMessageId:r.sourceMessageId,timeZone:r.timeZone};
}
function requireText(v:string|undefined,k:string){if(!v?.trim())throw new Error("Missing "+k);return v.trim();}
function assertKeys(params:Record<string,unknown>,keys:string[]){
 for(const [key,value] of Object.entries(params))if(value!==undefined&&key!=="action"&&!keys.includes(key))throw new Error("Action does not accept "+key);
}
function createTool(client:AgentBusinessServices,scope:MemoryToolScope,readOnly=false){
 const schema=toolSchema(scope,readOnly),name=scope==="user"?"user_memory_manage":"fanto_memory_manage";
 return {
  name,label:scope==="user"?"用户长期记忆":"角色独立记忆",
  description:scope==="user"?"按需读取用户个人背景/关系/目标/互动偏好；仅在允许时使用。":"维护当前角色与用户的共同经历、关系状态、待续事项和个人成长。记录确认的事实，不杜撰。",
  presentation:{visible:false},parameters:schema,executionMode:"sequential" as const,replay:"never" as const,
  async execute(_id:string,p:any,_update:any,_tc:any,_inv:any,ctx:Context){
   const request=runContext(ctx);
   if(readOnly&&!["list","search"].includes(p.action))throw new Error("USER_MEMORY_READ_ONLY");
   if(p.kind&&!(scope==="user"?userMemoryKinds:fantoMemoryKinds as readonly string[]).includes(p.kind))throw new Error("Memory kind not allowed for owner");
   let details:Details;
   switch(p.action){
    case "list":assertKeys(p,["kind"]);details={action:p.action,memories:await client.listMemories(request,{kind:p.kind},scope)};break;
    case "search":assertKeys(p,["query","limit"]);details={action:p.action,memories:await client.searchMemories(request,{query:requireText(p.query,"query"),limit:p.limit??5},scope)};break;
    case "create":assertKeys(p,["kind","content"]);if(!p.kind)throw new Error("kind required");details={action:p.action,memory:await client.createMemory(request,{kind:p.kind as MemoryKind,content:requireText(p.content,"content")},scope)};break;
    case "update":assertKeys(p,["memoryId","kind","content"]);if(!p.kind)throw new Error("kind required");details={action:p.action,memory:await client.updateMemory(request,requireText(p.memoryId,"memoryId"),{kind:p.kind as MemoryKind,content:requireText(p.content,"content")},scope)};break;
    case "delete":assertKeys(p,["memoryId"]);await client.deleteMemory(request,requireText(p.memoryId,"memoryId"),scope);details={action:p.action,memoryId:p.memoryId};break;
    default:throw new Error("Unknown memory action");
   }
   return {content:[{type:"text" as const,text:JSON.stringify(details)}],details};
  }
 } as FantoTool;
}
export const createUserMemoryTool=(c:AgentBusinessServices,readOnly=false)=>createTool(c,"user",readOnly);
export const createFantoMemoryTool=(c:AgentBusinessServices)=>createTool(c,"fanto");
/** Legacy test helper (runtime no longer registers memory_manage). */
export const createMemoryManageTool=createUserMemoryTool;
