import assert from "node:assert/strict";
import {mkdtempSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test,{after} from "node:test";
import {CompiledQuery} from "kysely";
const dir=mkdtempSync(join(tmpdir(),"fanto-sql-log-"));
process.env.LOG_DIR=dir;
const {logSql}=await import("./logger.js");
after(()=>rmSync(dir,{recursive:true,force:true}));

test("SQL logs execution duration and SQLSTATE without parameters, literals, results or error data",()=>{
 logSql({level:"query",query:CompiledQuery.raw("select * from records where user_id = $1 and source = 'private-literal' -- private-comment",["private-parameter"]),queryDurationMillis:12.345});
 logSql({level:"error",query:CompiledQuery.raw("select $$private-dollar-body$$, $body$private-tagged-body$body$"),queryDurationMillis:23.456,error:Object.assign(new Error("private-error"),{code:"23505",detail:"private-detail"})});
 const raw=readFileSync(join(dir,"sql.log"),"utf8");
 assert.ok(!raw.includes("private-"));
 const entries=raw.trim().split("\n").map(line=>JSON.parse(line));
 assert.equal(entries[0].cost,12.35);
 assert.ok(entries[0].sql.includes("$1"));
 assert.equal(entries[1].cost,23.46);
 assert.equal(entries[1].errorCode,"23505");
 assert.equal(entries[1].level,"error");
});

test("API access log includes a nonnegative millisecond cost on rejected requests",async()=>{
 const {createApp}=await import("../../bootstrap/app.js");
 const app=createApp({records:{} as never,media:{} as never});
 const response=await app.request("/api/records");
 assert.equal(response.status,401);
 const log=JSON.parse(readFileSync(join(dir,"access.log"),"utf8").trim().split("\n").at(-1)!);
 assert.equal(log.path,"/api/records");
 assert.equal(log.status,401);
 assert.equal(typeof log.cost,"number");
 assert.ok(log.cost>=0);
});
