import type {Memory,MemorySearchResult} from "./model.js";
export interface MemoryRepository {
 count(fantoId:string):Promise<number>;
 create(input:Omit<Memory,"createdAt"|"updatedAt">&{embedding:number[]}):Promise<Memory>;
 find(fantoId:string,memoryId:string):Promise<Memory|undefined>;
 list(fantoId:string,limit:number):Promise<Memory[]>;
 update(input:Pick<Memory,"fantoId"|"memoryId"|"content">&{embedding:number[]}):Promise<Memory|undefined>;
 remove(fantoId:string,memoryId:string):Promise<boolean>;
 search(input:{fantoId:string;embedding:number[];limit:number}):Promise<MemorySearchResult[]>;
}
