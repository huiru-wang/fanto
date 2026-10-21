import assert from "node:assert/strict";
import test from "node:test";
import {MainDynamicProvider,mainDynamicText,boundedFantoMemory} from "./main-dynamic.js";
import {createRunContext} from "../run-context.js";
import {emptyRole,defaultAgentConfig,type FantoSettings} from "../../../domain/fanto/model.js";
const role=():FantoSettings=>({fantoId:"role",userId:"owner",sessionId:"session",nickname:"fanto",description:"",avatarMediaId:null,roleConfig:emptyRole(),agentConfig:defaultAgentConfig(),status:"active",archivedAt:null,version:1,createdAt:"now",updatedAt:"now"});
test("role prompt includes memory policy only when enabled",()=>{
 const f=role();let text=mainDynamicText(f);
 assert.match(text,/fanto_memory_manage|第一人称|名字/);
 assert.doesNotMatch(text,/user_memory_manage|User Memory/);
 f.agentConfig.fantoMemoryEnabled=false;text=mainDynamicText(f);
 assert.doesNotMatch(text,/fanto_memory_manage|我的长期记忆/);
 f.agentConfig.narrationEnabled=true;assert.match(mainDynamicText(f),/Markdown 引用块/);
});
test("role context reads only its own memory when enabled",async()=>{
 const calls:string[]=[],f=role();
 const provider=new MainDynamicProvider({listMemories:async(ctx:any)=>{calls.push(ctx.sessionId);return [{memoryId:"m",content:"我认识霄汉",createdAt:"now",updatedAt:"now"}];}} as never);
 const context=()=>createRunContext({runId:"r",userId:"owner",sessionId:"session",query:"hello",mainConfig:f,slots:{},recentMessages:[]});
 assert.match((await provider.build(context())).content,/我认识霄汉/);assert.deepEqual(calls,["session"]);
 f.agentConfig.fantoMemoryEnabled=false;
 assert.doesNotMatch((await provider.build(context())).content,/我认识霄汉/);assert.deepEqual(calls,["session"]);
});
test("memory bounded injection preserves whole entries",()=>{
 const items=Array.from({length:49},(_,i)=>({memoryId:`m${i}`,content:"界".repeat(950),createdAt:"now",updatedAt:"now"}));
 const text=boundedFantoMemory(items);assert.ok(Buffer.byteLength(text,"utf8")<=12000);
 const parsed=JSON.parse(text);assert.ok(parsed.length<items.length);
 for(const item of parsed)assert.equal(item.content.length,950);
});
