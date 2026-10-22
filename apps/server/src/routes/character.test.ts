import test from "node:test";
import assert from "node:assert/strict";
import {createApp,logSafeBody} from "../bootstrap/app.js";
import {mainDynamicText} from "../agent/context/providers/main-dynamic.js";
import {emptyRole,defaultAgentConfig,type FantoSettings} from "../domain/fanto/model.js";
const auth={sessions: { verify:async(userId:string)=>({userId}) },assertActiveUser:async()=>{}} as never;
test("old character writes are rejected; role memory guidance follows setting",async()=>{
 const app=createApp({auth,records:{} as never,media:{} as never,fanto:{getSettings:async()=>null} as never});
 assert.equal((await app.request("/api/character")).status,401);
 assert.equal((await app.request("/api/character",{method:"PUT",headers:{Authorization:"Bearer user"},body:"{}"})).status,409);
 assert.equal(logSafeBody("/api/character",{character:"private"}),"[REDACTED]");
 const role:FantoSettings={fantoId:"role",userId:"user",sessionId:"session",nickname:"fanto",description:"",avatarMediaId:null,roleConfig:emptyRole(),agentConfig:defaultAgentConfig(),status:"active",archivedAt:null,version:1,createdAt:"now",updatedAt:"now"};
 role.agentConfig.fantoMemoryEnabled=false;
 assert.equal(mainDynamicText(role).includes("fanto_memory_manage"),false);
});
