import type {Kysely,Transaction} from "kysely";
import {sql} from "kysely";
import type {DB} from "../../infrastructure/database/schema.js";
import {agentConfigSchema,roleSchema,FantoError,type FantoSettings} from "./model.js";
export const MAX_ACTIVE_FANTOS=3;
type Runner=Kysely<DB>|Transaction<DB>;
export class PostgresFantoRepository {
 constructor(readonly db:Kysely<DB>){}
 async list(userId:string,includeArchived=false):Promise<FantoSettings[]>{
   let q=this.db.selectFrom("user_fantos").selectAll().where("user_id","=",userId);
   if(!includeArchived)q=q.where("status","=","active");
   const rows=await q.orderBy("created_at","desc").orderBy("fanto_id","desc").execute();
   return Promise.all(rows.map(row=>this.toSettings(row)));
 }
 async find(userId:string,fantoId:string):Promise<FantoSettings|undefined>{
  const row=await this.db.selectFrom("user_fantos").selectAll().where("user_id","=",userId).where("fanto_id","=",fantoId).executeTakeFirst();
  return row?this.toSettings(row):undefined;
 }
 async findBySession(userId:string,sessionId:string):Promise<FantoSettings|null>{
  const owner=await sql<{scope_key:string}>`SELECT scope_key FROM agent_session.sessions WHERE id=${sessionId} AND user_id=${userId} AND agent_id='main'`.execute(this.db);
  const scope=owner.rows[0]?.scope_key;
  if(!scope)throw new FantoError("NOT_FOUND",404);
  if(scope==="default")return null;
  const result=await this.find(userId,scope);
  if(!result || result.status!=="active")throw new FantoError("INVALID_STATE",409);
  return result;
 }
 async sessionId(db:Runner,userId:string,scopeKey:string):Promise<string|undefined>{
  const result=await sql<{id:string}>`SELECT id FROM agent_session.sessions WHERE user_id=${userId} AND agent_id='main' AND scope_key=${scopeKey}`.execute(db);
  return result.rows[0]?.id;
 }
 async toSettings(row:import("kysely").Selectable<import("../../infrastructure/database/schema.js").UserFantosTable>):Promise<FantoSettings>{
  const sessionId=await this.sessionId(this.db,row.user_id,row.fanto_id);
  if(!sessionId)throw new Error("FANTO_SESSION_MISSING");
  return {
   fantoId:row.fanto_id,userId:row.user_id,nickname:row.nickname,description:row.description,
   avatarMediaId:row.avatar_media_id,roleConfig:roleSchema.parse(row.role_config),
   agentConfig:agentConfigSchema.parse(row.agent_config),status:row.status,
   archivedAt:row.archived_at?.toISOString()??null,sessionId,version:row.version,
   createdAt:row.created_at.toISOString(),updatedAt:row.updated_at.toISOString()
  };
 }
}
