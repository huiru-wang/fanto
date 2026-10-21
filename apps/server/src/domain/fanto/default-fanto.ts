import {randomUUID} from "node:crypto";
import {sql,type Kysely,type Transaction} from "kysely";
import type {DB} from "../../infrastructure/database/schema.js";
import {emptyRole} from "./model.js";
import {FantoError} from "./model.js";
/** Caller serializes with the user row lock (or owns the new user transaction). */
export async function ensureDefaultFanto(trx:Transaction<DB>|Kysely<DB>,userId:string){
 const current=await trx.selectFrom("user_fantos").select(["fanto_id","status"]).where("user_id","=",userId).where("nickname","=","fanto").executeTakeFirst();
 let fantoId=current?.fanto_id;
 if(current&&current.status!=="active")throw new FantoError("INVALID_STATE",409);
 if(!fantoId){
  const n=await trx.selectFrom("user_fantos").select(({fn})=>fn.count<number>("fanto_id").as("n")).where("user_id","=",userId).where("status","=","active").executeTakeFirstOrThrow();
  if(Number(n.n)>=3)throw new FantoError("FANTO_LIMIT_REACHED",409);
  fantoId=randomUUID();const now=new Date();
  await trx.insertInto("user_fantos").values({fanto_id:fantoId,user_id:userId,nickname:"fanto",description:"",avatar_media_id:null,
   role_config:JSON.stringify(emptyRole()),agent_config:JSON.stringify({recordReadEnabled:true,fantoMemoryEnabled:true,narrationEnabled:false}),
   status:"active",archived_at:null,version:1,created_at:now,updated_at:now}).execute();
 }
 let session=(await sql<{id:string}>`SELECT id FROM agent_session.sessions WHERE user_id=${userId} AND agent_id='main' AND scope_key=${fantoId}`.execute(trx)).rows[0]?.id;
 if(!session){session=randomUUID();const now=Date.now();
  await sql`INSERT INTO agent_session.sessions(id,user_id,agent_id,scope_key,created_at,updated_at,next_seq)
   VALUES(${session},${userId},'main',${fantoId},${now},${now},0)`.execute(trx);
 }
 return {sessionId:session,agentId:"main",scopeKey:fantoId};
}
