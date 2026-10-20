import type {Kysely} from "kysely";
import type {DB} from "../../infrastructure/database/schema.js";
import type {EmbeddingProvider} from "./embedding-provider.js";
import {type Memory, type MemoryKind, type MemoryOwner, type MemorySearchResult, validMemoryKind, userOwner} from "./model.js";
import type {MemoryRepository} from "./repository.js";
import {PostgresMemoryRepository} from "./postgres-repository.js";
const MAX_PER_OWNER=50, MAX_PREFERENCES=20, MAX_CONTENT=1000;
const normalized = (text:string) => { const content=text.trim(); if(!content || content.length>MAX_CONTENT) throw new Error("Invalid memory content"); return content; };
const ownerOf=(owner:MemoryOwner|string):MemoryOwner=>typeof owner==="string"?userOwner(owner):owner;
function check(owner:MemoryOwner,kind:MemoryKind) { if(!validMemoryKind(owner,kind)) throw new Error("Memory kind not allowed for owner"); }
export class MemoryService {
 constructor(private readonly repository:MemoryRepository,private readonly embeddings:EmbeddingProvider) {}
 static create(db:Kysely<DB>,embeddings:EmbeddingProvider) {return new MemoryService(new PostgresMemoryRepository(db),embeddings);}
 async list(target:MemoryOwner|string,input:{kind?:MemoryKind;limit?:number}={}):Promise<Memory[]>{
  const owner=ownerOf(target); if(input.kind)check(owner,input.kind);
  return this.repository.list(owner,{kind:input.kind,limit:Math.min(Math.max(input.limit??50,1),50)});
 }
 async search(target:MemoryOwner|string,query:string,limit=10,kinds?:readonly MemoryKind[]):Promise<MemorySearchResult[]>{
  const owner=ownerOf(target); if(kinds)for(const kind of kinds)check(owner,kind);
  if(kinds?.length===0)return [];
  return this.repository.search({...owner,embedding:await this.embeddings.embed(normalized(query)),limit:Math.min(Math.max(limit,1),10),kinds});
 }
 async create(target:MemoryOwner|string,input:{kind:MemoryKind;content:string}):Promise<Memory>{
  const owner=ownerOf(target);check(owner,input.kind);const content=normalized(input.content);
  if(await this.repository.countByOwner(owner)>=MAX_PER_OWNER)throw new Error("Memory capacity reached");
  if(input.kind==="interaction_preferences"&&await this.repository.countByOwner(owner,input.kind)>=MAX_PREFERENCES)throw new Error("Memory preferences capacity reached");
  return this.repository.create({...owner,memoryId:crypto.randomUUID(),kind:input.kind,content,embedding:await this.embeddings.embed(content)});
 }
 async update(target:MemoryOwner|string,memoryId:string,input:{kind:MemoryKind;content:string}):Promise<Memory|undefined>{
  const owner=ownerOf(target);check(owner,input.kind);
  const existing=await this.repository.find(owner,memoryId);if(!existing)return undefined;
  if(input.kind==="interaction_preferences"&&existing.kind!=="interaction_preferences"&&await this.repository.countByOwner(owner,input.kind)>=MAX_PREFERENCES)throw new Error("Memory preferences capacity reached");
  const content=normalized(input.content);
  return this.repository.update({...owner,memoryId,kind:input.kind,content,embedding:await this.embeddings.embed(content)});
 }
 remove(target:MemoryOwner|string,memoryId:string){return this.repository.remove(ownerOf(target),memoryId);}
}
