import { createHash } from "node:crypto";
import type { ObjectStorage, ObjectMetadata } from "../../../infrastructure/clients/storage/object-storage.js";
export class MemoryStorage implements ObjectStorage {
 readonly objects = new Map<string, {data:Buffer;contentType:string;metadata:Record<string,string>}>();
 failThumbnail=false;
 readonly writes:string[]=[];
 async signUpload(key:string,_type:string,seconds:number){return this.signRead(key,seconds);}
 async signRead(key:string,seconds:number){return {url:`https://storage.test/${key}`,expiresAt:new Date(Date.now()+seconds*1000).toISOString()};}
 async head(key:string):Promise<ObjectMetadata|null>{const value=this.objects.get(key);return value?{bytes:value.data.length,contentType:value.contentType,etag:createHash("sha256").update(value.data).digest("hex"),metadata:value.metadata}:null;}
 async getObject(key:string,options?:{maxBytes?:number}){const value=this.objects.get(key);if(!value)throw new Error("missing");if(options?.maxBytes!==undefined&&value.data.length>options.maxBytes)throw new Error("too large");return value.data;}
 async putObject(key:string,data:Buffer,contentType:string,options?:{metadata?:Record<string,string>}){if(this.failThumbnail&&key.endsWith(".webp"))throw new Error("temporary failure");this.writes.push(key);this.objects.set(key,{data,contentType,metadata:options?.metadata??{}});}
 async remove(key:string){this.objects.delete(key);}
}
