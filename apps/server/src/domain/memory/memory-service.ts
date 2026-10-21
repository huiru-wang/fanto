import type {Kysely} from "kysely";
import type {DB} from "../../infrastructure/database/schema.js";
import type {EmbeddingProvider} from "./embedding-provider.js";
import type {Memory,MemorySearchResult} from "./model.js";
import type {MemoryRepository} from "./repository.js";
import {PostgresMemoryRepository} from "./postgres-repository.js";
const MAX_PER_FANTO=50, MAX_CONTENT=1000;
const normalized=(text:string)=>{const content=text.trim();if(!content||content.length>MAX_CONTENT)throw new Error("Invalid memory content");return content;};
export class MemoryService {
 constructor(private readonly repository:MemoryRepository,private readonly embeddings:EmbeddingProvider){}
 static create(db:Kysely<DB>,embeddings:EmbeddingProvider){return new MemoryService(new PostgresMemoryRepository(db),embeddings);}
 list(fantoId:string,limit=MAX_PER_FANTO):Promise<Memory[]>{return this.repository.list(fantoId,Math.min(Math.max(limit,1),50));}
 async search(fantoId:string,query:string,limit=10):Promise<MemorySearchResult[]>{return this.repository.search({fantoId,embedding:await this.embeddings.embed(normalized(query)),limit:Math.min(Math.max(limit,1),10)});}
 async create(fantoId:string,input:{content:string}):Promise<Memory>{
  const content=normalized(input.content);
  if(await this.repository.count(fantoId)>=MAX_PER_FANTO)throw new Error("Memory capacity reached");
  return this.repository.create({fantoId,memoryId:crypto.randomUUID(),content,embedding:await this.embeddings.embed(content)});
 }
 async update(fantoId:string,memoryId:string,input:{content:string}):Promise<Memory|undefined>{
  const content=normalized(input.content);
  if(!await this.repository.find(fantoId,memoryId))return undefined;
  return this.repository.update({fantoId,memoryId,content,embedding:await this.embeddings.embed(content)});
 }
 remove(fantoId:string,memoryId:string){return this.repository.remove(fantoId,memoryId);}
}
