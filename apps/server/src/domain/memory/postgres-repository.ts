import {sql,type Kysely} from "kysely";
import type {DB} from "../../infrastructure/database/schema.js";
import {type Memory,type MemoryKind,type MemoryOwner,type MemorySearchResult} from "./model.js";
import type {MemoryRepository} from "./repository.js";
const iso=(value:Date|string)=>value instanceof Date?value.toISOString():new Date(value).toISOString();
const vector=(items:number[])=>JSON.stringify(items);
type Row={memory_id:string;owner_type:"user"|"fanto";owner_id:string;kind:MemoryKind;content:string;created_at:Date;updated_at:Date};
const convert=(r:Row):Memory=>({memoryId:r.memory_id,ownerType:r.owner_type,ownerId:r.owner_id,kind:r.kind,content:r.content,createdAt:iso(r.created_at),updatedAt:iso(r.updated_at)});
export class PostgresMemoryRepository implements MemoryRepository {
 constructor(private readonly db:Kysely<DB>){}
 async countByOwner(owner:MemoryOwner,kind?:MemoryKind):Promise<number>{
  let q=this.db.selectFrom("memories").select(({fn})=>fn.count<number>("memory_id").as("count")).where("owner_type","=",owner.ownerType).where("owner_id","=",owner.ownerId);
  if(kind)q=q.where("kind","=",kind);
  return Number((await q.executeTakeFirstOrThrow()).count);
 }
 async create(input:Omit<Memory,"createdAt"|"updatedAt">&{embedding:number[]}):Promise<Memory>{
  return this.db.transaction().execute(async trx=>{
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.ownerType+":"+input.ownerId},0))`.execute(trx);
  const repo=new PostgresMemoryRepository(trx);
  if(await repo.countByOwner(input)>=50)throw new Error("Memory capacity reached");
  if(input.kind==="interaction_preferences"&&await repo.countByOwner(input,input.kind)>=20)throw new Error("Memory preferences capacity reached");
  const now=new Date();
  const rows=await sql<Row>`INSERT INTO memories (memory_id,owner_type,owner_id,kind,content,embedding,created_at,updated_at)
    VALUES (${input.memoryId},${input.ownerType},${input.ownerId},${input.kind},${input.content},${vector(input.embedding)}::vector,${now},${now})
    RETURNING memory_id,owner_type,owner_id,kind,content,created_at,updated_at`.execute(trx);
  return convert(rows.rows[0]!);
  });
 }
 async find(owner:MemoryOwner,memoryId:string):Promise<Memory|undefined>{
  const row=await this.db.selectFrom("memories").selectAll().where("owner_type","=",owner.ownerType).where("owner_id","=",owner.ownerId).where("memory_id","=",memoryId).executeTakeFirst();
  return row?convert(row):undefined;
 }
 async list(owner:MemoryOwner,input:{kind?:MemoryKind;limit:number}):Promise<Memory[]>{
  let q=this.db.selectFrom("memories").selectAll().where("owner_type","=",owner.ownerType).where("owner_id","=",owner.ownerId);
  if(input.kind)q=q.where("kind","=",input.kind);
  return (await q.orderBy("updated_at","desc").orderBy("memory_id","desc").limit(input.limit).execute()).map(convert);
 }
 async update(input:Pick<Memory,"ownerType"|"ownerId"|"memoryId"|"kind"|"content">&{embedding:number[]}):Promise<Memory|undefined>{
  return this.db.transaction().execute(async trx=>{
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.ownerType+":"+input.ownerId},0))`.execute(trx);
  const repo=new PostgresMemoryRepository(trx),existing=await repo.find(input,input.memoryId);
  if(!existing)return undefined;
  if(input.kind==="interaction_preferences"&&existing.kind!==input.kind&&await repo.countByOwner(input,input.kind)>=20)throw new Error("Memory preferences capacity reached");
  const now=new Date();
  const rows=await sql<Row>`UPDATE memories SET kind=${input.kind},content=${input.content},embedding=${vector(input.embedding)}::vector,updated_at=${now}
    WHERE owner_type=${input.ownerType} AND owner_id=${input.ownerId} AND memory_id=${input.memoryId}
    RETURNING memory_id,owner_type,owner_id,kind,content,created_at,updated_at`.execute(trx);
  return rows.rows[0]?convert(rows.rows[0]):undefined;
  });
 }
 async remove(owner:MemoryOwner,memoryId:string):Promise<boolean>{
  const row=await this.db.deleteFrom("memories").where("owner_type","=",owner.ownerType).where("owner_id","=",owner.ownerId).where("memory_id","=",memoryId).returning("memory_id").executeTakeFirst();
  return Boolean(row);
 }
 async search(input:MemoryOwner&{embedding:number[];limit:number;kinds?:readonly MemoryKind[]}):Promise<MemorySearchResult[]>{
  const kinds=input.kinds??(input.ownerType==="user"?["personal_background","important_relationships","current_focus","interaction_preferences"]:["shared_history","relationship_state","ongoing_threads","personal_experiences"]);
  if(kinds.length===0)return [];
  const rows=await sql<Row&{distance:number}>`SELECT memory_id,owner_type,owner_id,kind,content,created_at,updated_at,
     (embedding <-> ${vector(input.embedding)}::vector)::float8 AS distance
     FROM memories WHERE owner_type=${input.ownerType} AND owner_id=${input.ownerId} AND kind IN (${sql.join(kinds)})
     ORDER BY embedding <-> ${vector(input.embedding)}::vector LIMIT ${input.limit}`.execute(this.db);
  return rows.rows.map(row=>({...convert(row),distance:Number(row.distance)}));
 }
}
