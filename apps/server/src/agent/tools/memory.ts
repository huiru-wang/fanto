import {Type} from "typebox";
import type {Context} from "@earendil-works/pi-agent-core";
import type {AgentBusinessServices,AgentMemory,AgentMemorySearch} from "../business-services.js";
import {createRunContext} from "../context/index.js";
import type {FantoTool} from "./types.js";
const actions=Type.Union(["list","search","create","update","delete"].map(x=>Type.Literal(x)) as [ReturnType<typeof Type.Literal>,...ReturnType<typeof Type.Literal>[]]);
const schema=Type.Object({action:actions,memoryId:Type.Optional(Type.String({minLength:1})),
 content:Type.Optional(Type.String({minLength:1,maxLength:1000})),
 query:Type.Optional(Type.String({minLength:1,maxLength:1000})),limit:Type.Optional(Type.Integer({minimum:1,maximum:10}))},{additionalProperties:false});
type Details={action:string;memories?:AgentMemory[]|AgentMemorySearch[];memory?:AgentMemory;memoryId?:string};
const required=(v:string|undefined,k:string)=>{if(!v?.trim())throw new Error("Missing "+k);return v.trim();};
const assertKeys=(p:Record<string,unknown>,keys:string[])=>{for(const [k,v]of Object.entries(p))if(v!==undefined&&k!=="action"&&!keys.includes(k))throw new Error("Action does not accept "+k);};
export function createFantoMemoryTool(client:AgentBusinessServices):FantoTool{
 return {name:"fanto_memory_manage",label:"角色独立记忆",description:"维护当前角色自己确认的长期事实、与对方的关系、经历和待续话题。使用第一人称，按需检索、创建、更新或删除，不杜撰。",
 presentation:{visible:false},parameters:schema,executionMode:"sequential",replay:"never",
 async execute(_id:string,p:any,_update:any,_tc:any,_inv:any,context:Context){
  const r=createRunContext.read(context);
  const request={userId:r.userId,sessionId:r.sessionId,signal:context.abortSignal,traceId:r.traceId,sourceMessageId:r.sourceMessageId,timeZone:r.timeZone};
  let details:Details;
  switch(p.action){
   case "list":assertKeys(p,[]);details={action:p.action,memories:await client.listMemories(request)};break;
   case "search":assertKeys(p,["query","limit"]);details={action:p.action,memories:await client.searchMemories(request,{query:required(p.query,"query"),limit:p.limit??5})};break;
   case "create":assertKeys(p,["content"]);details={action:p.action,memory:await client.createMemory(request,{content:required(p.content,"content")})};break;
   case "update":assertKeys(p,["memoryId","content"]);details={action:p.action,memory:await client.updateMemory(request,required(p.memoryId,"memoryId"),{content:required(p.content,"content")})};break;
   case "delete":assertKeys(p,["memoryId"]);await client.deleteMemory(request,required(p.memoryId,"memoryId"));details={action:p.action,memoryId:p.memoryId};break;
   default:throw new Error("Unknown memory action");
  }
  return {content:[{type:"text" as const,text:JSON.stringify(details)}],details};
 }} as FantoTool;
}
