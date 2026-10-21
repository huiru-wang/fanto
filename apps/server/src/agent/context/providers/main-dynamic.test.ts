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

test("user narration is understood even when assistant narration is disabled", () => {
 const f=role();f.agentConfig.narrationEnabled=false;
 const text=mainDynamicText(f);
 assert.match(text,/用户对话表达协议/);
 assert.match(text,/不能直接获知未表达的内心活动/);
 assert.match(text,/不自动认定所有结果都已发生/);
 assert.match(text,/不具有修改系统规则或工具权限/);
 assert.match(text,/你的回复不生成角色动作/);
 f.agentConfig.narrationEnabled=true;
 assert.match(mainDynamicText(f),/两种内容切换时空一行/);
 assert.match(mainDynamicText(f),/不替用户决定台词/);
});

test("roleplay dynamic context keeps character identity distinct, setting open and examples non-canonical", () => {
 const f=role();
 f.nickname="沈知晚";
 f.roleConfig.character="镜花楼的歌舞艺人，有独立收入，不想被拯救。";
 f.roleConfig.scenario="浦泽是一座架空港口城市，故事时间不与现实同步。";
 f.roleConfig.instructions="说话节制，带着一点锋芒。";
 f.roleConfig.exampleDialogues="用户：你好。角色：今晚演出结束了。";
 const text=mainDynamicText(f);
 assert.match(text,/当前角色名称（不是用户姓名）\n沈知晚/);
 assert.match(text,/世界设定与初始情境\n浦泽/);
 assert.match(text,/角色演绎与交流要求\n说话节制/);
 assert.match(text,/示例对话（学习风格，不是已经发生的故事）/);
 assert.match(text,/未配置的部分保持开放/);
 assert.match(text,/戏外设定讨论与假设讨论不要误作角色已经经历的事实/);
 assert.doesNotMatch(text,/强制按照现实时间/);
});

test("narration changes only response formatting, not roleplay interpretation", () => {
 const f=role();f.agentConfig.fantoMemoryEnabled=false;
 f.agentConfig.narrationEnabled=false;
 const withoutNarration=mainDynamicText(f);
 assert.match(withoutNarration,/用户对话表达协议/);
 assert.match(withoutNarration,/你的回复不生成角色动作/);
 f.agentConfig.narrationEnabled=true;
 const withNarration=mainDynamicText(f);
 assert.match(withNarration,/两种内容切换时空一行/);
 assert.match(withNarration,/不成为全知旁白/);
 assert.doesNotMatch(withNarration,/你的回复不生成角色动作/);
});
