import assert from "node:assert/strict";
import test from "node:test";
import {MainDynamicProvider,mainDynamicText} from "./main-dynamic.js";
import {createRunContext} from "../run-context.js";
import {emptyRole,defaultAgentConfig,type FantoSettings} from "../../../domain/fanto/model.js";

const role=():FantoSettings=>({fantoId:"role",userId:"owner",sessionId:"session",nickname:"",description:"",
  avatarMediaId:null,roleConfig:emptyRole(),agentConfig:defaultAgentConfig(),status:"active",archivedAt:null,
  version:1,createdAt:"now",updatedAt:"now"});

test("dynamic persona omits empty slots; tool and narration guidance follows capabilities",()=>{
  const f=role(),text=mainDynamicText(f);
  assert.doesNotMatch(text,/## 角色名称|## 身份与性格|## 世界与关系|## 交流方式|## 示例|record_read|user_memory_manage|（无）/);
  assert.match(text,/fanto_memory_manage/);
  assert.match(text,/不生成角色动作/);
  f.roleConfig.character="某角色";f.agentConfig.narrationEnabled=true;f.agentConfig.recordReadEnabled=true;
  assert.match(mainDynamicText(f),/某角色/);assert.match(mainDynamicText(f),/record_read/);
  assert.match(mainDynamicText(f),/Markdown 引用块/);
  assert.doesNotMatch(mainDynamicText(null),/fanto_memory_manage|## 角色名称/);
  assert.match(mainDynamicText(null),/user_memory_manage/);
});

test("providers read only authorized scopes, omit unrelated user categories and bound memory bytes",async()=>{
  const calls:string[]=[],f=role();
  const provider=new MainDynamicProvider({listMemories:async(_ctx:any,_input:any,scope:string)=>{
    calls.push(scope);return [
      {memoryId:"secret",kind:"important_relationships",content:"不应默认注入的关系"},
      {memoryId:"base",kind:scope==="user"?"personal_background":"shared_history",content:"界".repeat(1000)},
      ...Array.from({length:49},()=>({kind:scope==="user"?"personal_background":"shared_history",content:"界".repeat(1000)}))
    ] as any;
  }} as never);
  const context=()=>createRunContext({runId:"r",userId:"owner",sessionId:"session",query:"q",mainConfig:f,slots:{},recentMessages:[]});
  await provider.build(context());assert.deepEqual(calls,["fanto"]);
  calls.length=0;f.agentConfig.userMemoryEnabled=true;
  const result=await provider.build(context());assert.deepEqual(calls,["user","fanto"]);
  // Fanto scope fixture's unrelated category is not used to assert user filtering.
  assert.ok(Buffer.byteLength(result.content)<27000);
});
