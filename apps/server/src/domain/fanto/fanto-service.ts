import {randomUUID} from "node:crypto";
import {sql,type Kysely} from "kysely";
import type {DB} from "../../infrastructure/database/schema.js";
import type {MediaService} from "../media/index.js";
import {PostgresFantoRepository,MAX_ACTIVE_FANTOS} from "./postgres-repository.js";
import {ensureDefaultFanto} from "./default-fanto.js";
import {agentConfigSchema,defaultAgentConfig,fantoActionSchema,fantoCreateSchema,fantoPatchSchema,FantoError,type FantoSettings} from "./model.js";

export class FantoService {
 private readonly repo:PostgresFantoRepository;
 private readonly busy=new Set<string>();
 private isSessionRunning:(sessionId:string)=>boolean=()=>false;
 private closeSession:(sessionId:string)=>Promise<void>=async()=>{};
 constructor(private readonly db:Kysely<DB>,private readonly media:Pick<MediaService,"validateAvatar"|"queueFantoDeletion"|"finishFantoDeletion">){
   this.repo=new PostgresFantoRepository(db);
 }
 static create(db:Kysely<DB>,media:MediaService){return new FantoService(db,media);}
 bindSessions(handlers:{isRunning(sessionId:string):boolean;release(sessionId:string):Promise<void>}){
  this.isSessionRunning=id=>handlers.isRunning(id);
  this.closeSession=id=>handlers.release(id);
 }
 async list(userId:string,includeArchived=false){await this.defaultSession(userId);return this.repo.list(userId,includeArchived);}
 async get(userId:string,fantoId:string){const f=await this.repo.find(userId,fantoId);if(!f)throw new FantoError("NOT_FOUND",404);return f;}
 async getForSession(userId:string,sessionId:string){return this.repo.findBySession(userId,sessionId);}
 /** Reservation and lifecycle changes serialize on the same user row (single runtime process). */
 async reserveRun(userId:string,sessionId:string,reserve:()=>Promise<()=>void>|(()=>void)){
  let release:(()=>void)|undefined;
  try {
   return await this.db.transaction().execute(async trx=>{
    await trx.selectFrom("users").select("user_id").where("user_id","=",userId).forUpdate().executeTakeFirstOrThrow();
    await new PostgresFantoRepository(trx).findBySession(userId,sessionId);
    release=await reserve();
    return release;
   });
  } catch(error){release?.();throw error;}
 }
 async defaultSession(userId:string){
  return this.db.transaction().execute(async trx=>{
   await trx.selectFrom("users").select("user_id").where("user_id","=",userId).forUpdate().executeTakeFirstOrThrow();
   return ensureDefaultFanto(trx,userId);
  });
 }
 async create(userId:string,input:unknown):Promise<FantoSettings>{
  const parsed=fantoCreateSchema.parse(input);
  const id=await this.db.transaction().execute(async trx=>{
    await trx.selectFrom("users").select("user_id").where("user_id","=",userId).forUpdate().executeTakeFirstOrThrow();
    await ensureDefaultFanto(trx,userId);
    const existing=await trx.selectFrom("user_fantos").select("fanto_id").where("user_id","=",userId).where(sql`lower(nickname)`,"=",parsed.nickname.toLowerCase()).executeTakeFirst();
    if(existing||parsed.nickname.toLowerCase()==="fanto")throw new FantoError("FANTO_NAME_TAKEN",409);
    const n=await trx.selectFrom("user_fantos").select(({fn})=>fn.count<number>("fanto_id").as("n")).where("user_id","=",userId).where("status","=","active").executeTakeFirstOrThrow();
    if(Number(n.n)>=MAX_ACTIVE_FANTOS)throw new FantoError("FANTO_LIMIT_REACHED",409);
    if(parsed.avatarMediaId&&!await this.media.validateAvatar(userId,parsed.avatarMediaId,trx))throw new FantoError("INVALID_AVATAR",422);
    const fantoId=randomUUID(),sessionId=randomUUID(),now=new Date(),stamp=now.getTime();
    await trx.insertInto("user_fantos").values({fanto_id:fantoId,user_id:userId,nickname:parsed.nickname,description:parsed.description,avatar_media_id:parsed.avatarMediaId,role_config:JSON.stringify(parsed.roleConfig),agent_config:JSON.stringify(parsed.agentConfig),status:"active",archived_at:null,version:1,created_at:now,updated_at:now}).execute();
    await sql`INSERT INTO agent_session.sessions(id,user_id,agent_id,scope_key,created_at,updated_at,next_seq)
     VALUES(${sessionId},${userId},'main',${fantoId},${stamp},${stamp},0)`.execute(trx);
    return fantoId;
  });
  return this.get(userId,id);
 }
 async patch(userId:string,input:unknown):Promise<FantoSettings>{
  const parsed=fantoPatchSchema.parse(input);
  await this.db.transaction().execute(async trx=>{
    await trx.selectFrom("users").select("user_id").where("user_id","=",userId).forUpdate().executeTakeFirstOrThrow();
    const row=await trx.selectFrom("user_fantos").selectAll().where("user_id","=",userId).where("fanto_id","=",parsed.fantoId).forUpdate().executeTakeFirst();
    if(!row)throw new FantoError("NOT_FOUND",404);
    if(row.nickname==="fanto"&&parsed.changes.agentConfig)throw new FantoError("FANTO_DEFAULT_PROTECTED",409);
    if(row.status!=="active")throw new FantoError("INVALID_STATE",409);
    if(row.version!==parsed.expectedVersion)throw new FantoError("VERSION_CONFLICT",409);
    const session=await this.repo.sessionId(trx,userId,parsed.fantoId);
    if(session&&this.isSessionRunning(session))throw new FantoError("FANTO_BUSY",409);
    const changes=parsed.changes;
    if(changes.avatarMediaId&&!await this.media.validateAvatar(userId,changes.avatarMediaId,trx))throw new FantoError("INVALID_AVATAR",422);
    const settings=agentConfigSchema.parse({...defaultAgentConfig(),...row.agent_config,...changes.agentConfig});
    await trx.updateTable("user_fantos").set({agent_config:JSON.stringify(settings),avatar_media_id:changes.avatarMediaId===undefined?row.avatar_media_id:changes.avatarMediaId,version:row.version+1,updated_at:new Date()}).where("fanto_id","=",parsed.fantoId).execute();
  });
  return this.get(userId,parsed.fantoId);
 }
 async setArchive(userId:string,input:unknown,archived:boolean):Promise<FantoSettings>{
  const parsed=fantoActionSchema.parse(input);
  const scope=parsed.fantoId;
  if(this.busy.has(scope))throw new FantoError("FANTO_BUSY",409);
  await this.db.transaction().execute(async trx=>{
   await trx.selectFrom("users").select("user_id").where("user_id","=",userId).forUpdate().executeTakeFirstOrThrow();
   const row=await trx.selectFrom("user_fantos").selectAll().where("fanto_id","=",scope).where("user_id","=",userId).forUpdate().executeTakeFirst();
   if(!row)throw new FantoError("NOT_FOUND",404);
   if(row.nickname==="fanto")throw new FantoError("FANTO_DEFAULT_PROTECTED",409);
   if(row.version!==parsed.expectedVersion)throw new FantoError("VERSION_CONFLICT",409);
   if(row.status!==(archived?"active":"archived"))throw new FantoError("INVALID_STATE",409);
   const session=await this.repo.sessionId(trx,userId,scope);
   if(session&&this.isSessionRunning(session))throw new FantoError("FANTO_BUSY",409);
   if(!archived){
    const n=await trx.selectFrom("user_fantos").select(({fn})=>fn.count<number>("fanto_id").as("n")).where("user_id","=",userId).where("status","=","active").executeTakeFirstOrThrow();
    if(Number(n.n)>=MAX_ACTIVE_FANTOS)throw new FantoError("FANTO_LIMIT_REACHED",409);
   }
   await trx.updateTable("user_fantos").set({status:archived?"archived":"active",archived_at:archived?new Date():null,updated_at:new Date(),version:row.version+1}).where("fanto_id","=",scope).execute();
  });
  return this.get(userId,scope);
 }
 /** One process run exclusion; multi-instance deployments require a distributed execution gate. */
 async remove(userId:string,input:unknown):Promise<boolean>{
  const parsed=fantoActionSchema.parse(input);
  if(this.busy.has(parsed.fantoId))throw new FantoError("FANTO_BUSY",409);
  this.busy.add(parsed.fantoId);
  try{
   const session=await this.repo.sessionId(this.db,userId,parsed.fantoId);
   if(session&&this.isSessionRunning(session))throw new FantoError("FANTO_BUSY",409);
   await this.db.transaction().execute(async trx=>{
    await trx.selectFrom("users").select("user_id").where("user_id","=",userId).forUpdate().executeTakeFirstOrThrow();
    const row=await trx.selectFrom("user_fantos").selectAll().where("fanto_id","=",parsed.fantoId).where("user_id","=",userId).forUpdate().executeTakeFirst();
    if(!row){
     const pending=await sql`SELECT 1 FROM fanto_media_deletions WHERE user_id=${userId} AND fanto_id=${parsed.fantoId}`.execute(trx);
     if(pending.rows.length)return;
     throw new FantoError("NOT_FOUND",404);
    }
    if(row.nickname==="fanto")throw new FantoError("FANTO_DEFAULT_PROTECTED",409);
    if(row.version!==parsed.expectedVersion)throw new FantoError("VERSION_CONFLICT",409);
    const ids=await sql<{id:string}>`SELECT id FROM agent_session.sessions WHERE user_id=${userId} AND agent_id='main' AND scope_key=${parsed.fantoId}`.execute(trx);
    for(const {id} of ids.rows){
      if(this.isSessionRunning(id))throw new FantoError("FANTO_BUSY",409);
      // Drain and detach checkpoints before removing their persistent parent.
      await this.closeSession(id);
      await sql`DELETE FROM agent_session.usage_ledger WHERE session_id=${id}`.execute(trx);
      await sql`DELETE FROM agent_session.entries WHERE session_id=${id}`.execute(trx);
      await sql`DELETE FROM agent_session.sessions WHERE id=${id}`.execute(trx);
    }
    await this.media.queueFantoDeletion(trx,userId,parsed.fantoId,row.avatar_media_id);
    await trx.deleteFrom("memories").where("fanto_id","=",parsed.fantoId).execute();
    await trx.deleteFrom("records").where("owner_type","=","fanto").where("owner_id","=",parsed.fantoId).execute();
    await trx.deleteFrom("user_fantos").where("fanto_id","=",parsed.fantoId).where("user_id","=",userId).execute();
   });
   return await this.media.finishFantoDeletion(this.db,userId,parsed.fantoId);
  }finally{this.busy.delete(parsed.fantoId);}
 }
 isDeleting(fantoId:string){return this.busy.has(fantoId);}
 /** Legacy clients must not mutate a persona or session through old endpoints. */
 async getSettings(userId:string){return (await this.list(userId))[0]??null;}
 async getConversationSettings(userId:string,sessionId?:string){
  return sessionId?this.getForSession(userId,sessionId):null;
 }
}
