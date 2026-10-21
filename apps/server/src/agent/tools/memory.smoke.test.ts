import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {resolve,join} from "node:path";
import {TODO_CONTEXT} from "@earendil-works/pi-agent-core";
import {MemorySessionRepo} from "@earendil-works/pi-agent-core/harness/session";
import {builtinModels} from "@earendil-works/pi-ai/providers/all";
import {loadEnv} from "../../bootstrap/config.js";
import {mainPrompt} from "../prompts/main.js";
import {buildRuntime} from "../harness/build-runtime.js";
import {runAgent} from "../harness/run.js";
import {SkillLoader} from "../skills/loader.js";
import {emptyRole,defaultAgentConfig,type FantoSettings} from "../../domain/fanto/model.js";
import type {AgentBusinessServices,AgentMemory} from "../business-services.js";
const cases=[
 {name:"remember given name",message:"我是霄汉，你叫什么名字？",test:(actions:string[],rows:AgentMemory[])=>{assert.ok(actions.includes("create"));assert.match(rows.map(x=>x.content).join(" "),/霄汉/);}},
 {name:"explicit request to remember",message:"你要记住我的名字叫霄汉哦。",test:(actions:string[],rows:AgentMemory[])=>{assert.ok(actions.includes("create"));assert.match(rows.map(x=>x.content).join(" "),/霄汉/);}},
];
const smoke=process.env.MEMORY_SMOKE_TEST==="1"?test:test.skip;
smoke("real role model stores memory without kind",{timeout:180000},async t=>{
 loadEnv();const models=builtinModels();
 for(const scenario of cases)await t.test(scenario.name,{timeout:65000},async()=>{
  const workspace=mkdtempSync(join(tmpdir(),"fanto-memory-smoke-"));
  const repo=new MemorySessionRepo();const session=await repo.create({},TODO_CONTEXT);
  const role:FantoSettings={fantoId:randomUUID(),userId:"test-user",sessionId:session.metadata.id,nickname:"沈知晚",description:"",avatarMediaId:null,roleConfig:emptyRole(),agentConfig:defaultAgentConfig(),status:"active",archivedAt:null,version:1,createdAt:"now",updatedAt:"now"};
  const rows=new Map<string,AgentMemory>(),actions:string[]=[];
  const fanto={getFantoConversationSettings:async()=>role,
   listMemories:async()=>[...rows.values()],
   searchMemories:async()=>{actions.push("search");return [...rows.values()].map(x=>({...x,distance:0.1}));},
   createMemory:async(_ctx:unknown,input:{content:string})=>{actions.push("create");const row={...input,memoryId:randomUUID(),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};rows.set(row.memoryId,row);return row;},
   updateMemory:async(_ctx:unknown,id:string,input:{content:string})=>{actions.push("update");const row={...rows.get(id)!,...input,updatedAt:new Date().toISOString()};rows.set(id,row);return row;},
   deleteMemory:async(_ctx:unknown,id:string)=>{actions.push("delete");rows.delete(id);},
  } as unknown as AgentBusinessServices;
  const runtime=await buildRuntime(session,{id:"main",description:"memory smoke",modelId:"deepseek/deepseek-v4-flash",provider:"deepseek",model:"deepseek-v4-flash",systemPrompt:mainPrompt,tools:["fanto_memory_manage"],skills:[],compaction:{enabled:false,reserveTokens:1024,keepRecentTokens:1024},revision:"smoke"},workspace,{models,fanto,skills:new SkillLoader(resolve("skills"))});
  try{
   const result=await runAgent({id:session.metadata.id,userId:"test-user",agentId:"main",runtime},scenario.message,AbortSignal.timeout(50000),{timeZone:"Asia/Shanghai"},async()=>{});
   scenario.test(actions,[...rows.values()]);assert.ok(result.length>0);
  }finally{await runtime.close();await repo.close(TODO_CONTEXT);rmSync(workspace,{recursive:true,force:true});}
 });
});
