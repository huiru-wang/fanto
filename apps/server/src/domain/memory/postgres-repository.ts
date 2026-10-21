import {sql,type Kysely} from "kysely";
import type {DB} from "../../infrastructure/database/schema.js";
import type {Memory,MemorySearchResult} from "./model.js";
import type {MemoryRepository} from "./repository.js";
const iso=(value:Date|string)=>value instanceof Date?value.toISOString():new Date(value).toISOString();
const vector=(items:number[])=>JSON.stringify(items);
type Row={memory_id:string;fanto_id:string;content:string;created_at:Date;updated_at:Date};
const convert=(r:Row):Memory=>({memoryId:r.memory_id,fantoId:r.fanto_id,content:r.content,createdAt:iso(r.created_at),updatedAt:iso(r.updated_at)});
export class PostgresMemoryRepository implements MemoryRepository {
 constructor(private readonly db:Kysely<DB>){}
 async count(fantoId:string):Promise<number>{return Number((await this.db.selectFrom("memories").select(({fn})=>fn.count<number>("memory_id").as("count")).where("fanto_id","=",fantoId).executeTakeFirstOrThrow()).count);}
 async create(input:Omit<Memory,"createdAt"|"updatedAt">&{embedding:number[]}):Promise<Memory>{
  return this.db.transaction().execute(async trx=>{
   await sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.fantoId},0))`.execute(trx);
   const repo=new PostgresMemoryRepository(trx);
   if(await repo.count(input.fantoId)>=50)throw new Error("Memory capacity reached");
   const now=new Date();
   const rows=await sql<Row>`INSERT INTO memories (memory_id,fanto_id,content,embedding,created_at,updated_at)
    VALUES (${input.memoryId},${input.fantoId},${input.content},${vector(input.embedding)}::vector,${now},${now})
    RETURNING memory_id,fanto_id,content,created_at,updated_at`.execute(trx);
   return convert(rows.rows[0]!);
  });
 }
 async find(fantoId:string,memoryId:string):Promise<Memory|undefined>{
  const row=await this.db.selectFrom("memories").selectAll().where("fanto_id","=",fantoId).where("memory_id","=",memoryId).executeTakeFirst();
  return row?convert(row):undefined;
 }
 async list(fantoId:string,limit:number):Promise<Memory[]>{
  return (await this.db.selectFrom("memories").selectAll().where("fanto_id","=",fantoId).orderBy("updated_at","desc").orderBy("memory_id","desc").limit(limit).execute()).map(convert);
 }
 async update(input:Pick<Memory,"fantoId"|"memoryId"|"content">&{embedding:number[]}):Promise<Memory|undefined>{
  const now=new Date();
  const rows=await sql<Row>`UPDATE memories SET content=${input.content},embedding=${vector(input.embedding)}::vector,updated_at=${now}
    WHERE fanto_id=${input.fantoId} AND memory_id=${input.memoryId}
    RETURNING memory_id,fanto_id,content,created_at,updated_at`.execute(this.db);
  return rows.rows[0]?convert(rows.rows[0]):undefined;
 }
 async remove(fantoId:string,memoryId:string):Promise<boolean>{
  const row=await this.db.deleteFrom("memories").where("fanto_id","=",fantoId).where("memory_id","=",memoryId).returning("memory_id").executeTakeFirst();
  return Boolean(row);
 }
 async search(input:{fantoId:string;embedding:number[];limit:number}):Promise<MemorySearchResult[]>{
  const rows=await sql<Row&{distance:number}>`SELECT memory_id,fanto_id,content,created_at,updated_at,
   (embedding <-> ${vector(input.embedding)}::vector)::float8 AS distance
   FROM memories WHERE fanto_id=${input.fantoId}
   ORDER BY embedding <-> ${vector(input.embedding)}::vector LIMIT ${input.limit}`.execute(this.db);
  return rows.rows.map(row=>({...convert(row),distance:Number(row.distance)}));
 }
}
