import test from "node:test";
import assert from "node:assert/strict";
import {createApp,logSafeBody} from "../bootstrap/app.js";
import {mainDynamicText} from "../agent/context/providers/main-dynamic.js";
const auth={verifyAccess:async(userId:string)=>({userId}),assertActiveUser:async()=>{}} as never;
test("old character writes are rejected, default main does not invent persona",async()=>{
 const app=createApp({auth,records:{} as never,media:{} as never,fanto:{getSettings:async()=>null} as never});
 assert.equal((await app.request("/api/character")).status,401);
 assert.equal((await app.request("/api/character",{method:"PUT",headers:{Authorization:"Bearer user"},body:"{}"})).status,409);
 assert.equal(logSafeBody("/api/character",{character:"private"}),"[REDACTED]");
 assert.equal(mainDynamicText(null).includes("fanto_memory_manage"),false);
});
