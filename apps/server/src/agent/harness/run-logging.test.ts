import assert from "node:assert/strict";
import {mkdtempSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test,{after} from "node:test";
const dir=mkdtempSync(join(tmpdir(),"fanto-run-logging-"));
process.env.LOG_DIR=dir;
const {createRunContext}=await import("../context/run-context.js");
const {startRunLogging,touchRun,logRunEvent}=await import("./run-logging.js");
const {subscribeHarnessEvents}=await import("./events.js");
const {installHarnessHooks}=await import("./hooks.js");
after(()=>rmSync(dir,{recursive:true,force:true}));
const read=()=>readFileSync(join(dir,"service.log"),"utf8").trim().split("\n").map(line=>{
 const match=line.match(/^\[[^\]]+\] \[[^\]]+\] \[([^\]]+)\] (.*?) (\{.*\})$/)!;
 return {event:match[2],...JSON.parse(match[3])};
});
const context=()=>createRunContext({userId:"user",sessionId:"session",runId:"run",agentId:"creator-agent",proposalId:"proposal",projectId:"project",query:"private query",slots:{},recentMessages:[]});

test("watchdog identifies an unfinished tool and stops after run cleanup",t=>{
 t.mock.timers.enable({apis:["Date","setInterval"],now:1000});
 const data=createRunContext.read(context());
 const stop=startRunLogging(data);
 const handlers=new Map<string,any>();
 const off=subscribeHarnessEvents({events:{on:(name:string,fn:any)=>{handlers.set(name,fn);return()=>handlers.delete(name);}}} as never,[],data,"",async()=>{},()=>false,()=>{});
 handlers.get("tool_start")({toolCallId:"tool-1",toolName:"record_read",turnId:"turn",args:{secret:"do not log"}});
 t.mock.timers.tick(60_000);
 const waiting=read().at(-1);
 assert.equal(waiting.event,"waiting");
 assert.equal(waiting.phase,"tool started");
 assert.equal(waiting.proposalId,"proposal");
 assert.deepEqual(waiting.activeTools,[{toolCallId:"tool-1",toolName:"record_read",durationMs:60_000}]);
 touchRun(data);
 const beforeActivity=read().length;
 t.mock.timers.tick(30_000);
 assert.equal(read().length,beforeActivity);
 off();stop();
 const count=read().length;
 t.mock.timers.tick(120_000);
 assert.equal(read().length,count);
 assert.ok(!readFileSync(join(dir,"service.log"),"utf8").includes("do not log"));
});

test("model request/response logs correlate IDs and redact errors without recording payloads",async()=>{
 const handlers=new Map<string,any>();
 installHarnessHooks({hooks:{on:(name:string,fn:any)=>handlers.set(name,fn)}} as never,
  {workspace:process.cwd(),systemPrompt:{release:()=>{}} as never,transformContext:async()=>undefined});
 const ctx=context();const data=createRunContext.read(ctx);const stop=startRunLogging(data);
 await handlers.get("before_request")({model:{provider:"provider",id:"model"},step:"assistant",attempt:1,streamOptions:{timeoutMs:120000}},ctx);
 assert.equal(read().at(-1).event,"model request started");
 await handlers.get("after_response")({status:429,message:{stopReason:"error",errorMessage:"token=private https://example.com/private"}},ctx);
 const response=read().at(-1);
 assert.equal(response.httpStatus,429);
 assert.equal(response.sessionId,"session");
 assert.equal(response.runId,"run");
 assert.equal(response.proposalId,"proposal");
 assert.ok(!response.error.includes("private"));
 assert.equal(typeof response.durationMs,"number");stop();
});

test("tool failures, harness faults and handler errors retain safe diagnostic fields",async()=>{
 const data=createRunContext.read(context());const stop=startRunLogging(data);
 const handlers=new Map<string,any>();
 const off=subscribeHarnessEvents({events:{on:(name:string,fn:any)=>{handlers.set(name,fn);return()=>{};}}} as never,[],data,"",async()=>{},()=>false,()=>{});
 await handlers.get("message_update")({event:{type:"thinking_delta",delta:"private reasoning"}});
 assert.equal(read().at(-1).event,"model stream started");
 await handlers.get("tool_start")({toolCallId:"call",toolName:"record_read",turnId:"turn"});
 await handlers.get("tool_end")({toolCallId:"call",toolName:"record_read",turnId:"turn",isError:true,result:{details:{errorCode:"NOT_FOUND",secret:"sensitive-result"}}});
 assert.equal(read().at(-1).errorCode,"NOT_FOUND");
 assert.equal(read().at(-1).status,"failed");
 await handlers.get("fault")({code:"MODEL_ERROR",message:"token=secret"});
 assert.equal(read().at(-1).code,"MODEL_ERROR");
 await handlers.get("handler_error")({kind:"hook",hook:"after_response",error:"handler broke"});
 assert.equal(read().at(-1).handler,"after_response");
 logRunEvent(data,"completed");off();stop();
 assert.ok(!readFileSync(join(dir,"service.log"),"utf8").includes("sensitive-result"));
 assert.ok(!readFileSync(join(dir,"service.log"),"utf8").includes("private reasoning"));
});
