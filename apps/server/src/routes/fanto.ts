import {Hono} from "hono";
import {FantoError,fantoActionSchema,fantoPatchSchema,fantoCreateSchema,type FantoService} from "../domain/fanto/index.js";
import {requireUserId} from "./request-user.js";
import {z} from "zod";
const ok=(result:unknown)=>({success:true,result,errorCode:null,errorMsg:null});
function error(c:any,e:unknown){
 if(e instanceof FantoError)return c.json({success:false,result:null,errorCode:e.code,errorMsg:e.message},e.status);
 if(e instanceof Error&&e.name==="ZodError")return c.json({success:false,result:null,errorCode:"INVALID_INPUT",errorMsg:e.message},400);
 throw e;
}
const json=(c:any)=>c.req.json().catch(()=>null);
export function createFantosRoutes(service:FantoService){
 const app=new Hono();
 app.get("/",async c=>{
  const archived=c.req.query("includeArchived");
  if(archived!==undefined&&archived!=="true"&&archived!=="false")return c.json({errorCode:"INVALID_INPUT"},400);
  return c.json(ok(await service.list(requireUserId(c.req.raw),archived==="true")));
 });
 return app;
}
export function createFantoRoutes(service:FantoService){
 const app=new Hono();
 app.post("/",async c=>{try{return c.json(ok(await service.create(requireUserId(c.req.raw),fantoCreateSchema.parse(await json(c)))),201);}catch(e){return error(c,e);}});
 app.get("/",async c=>{try{
  const id=z.string().uuid().parse(c.req.query("fantoId"));
  return c.json(ok(await service.get(requireUserId(c.req.raw),id)));
 }catch(e){return error(c,e);}});
 app.patch("/",async c=>{try{return c.json(ok(await service.patch(requireUserId(c.req.raw),fantoPatchSchema.parse(await json(c)))));}catch(e){return error(c,e);}});
 app.post("/restart",async c=>{try{return c.json(ok(await service.restart(requireUserId(c.req.raw),fantoActionSchema.parse(await json(c)))));}catch(e){return error(c,e);}});
 app.post("/archive",async c=>{try{return c.json(ok(await service.setArchive(requireUserId(c.req.raw),fantoActionSchema.parse(await json(c)),true)));}catch(e){return error(c,e);}});
 app.post("/restore",async c=>{try{return c.json(ok(await service.setArchive(requireUserId(c.req.raw),fantoActionSchema.parse(await json(c)),false)));}catch(e){return error(c,e);}});
 app.delete("/",async c=>{try{
  const fantoId=c.req.query("fantoId"),version=c.req.header("If-Match");
  const complete=await service.remove(requireUserId(c.req.raw),{fantoId,expectedVersion:Number(version)});
  if(!complete)return c.json(ok({fantoId,deletionState:"pending"}),202);
  return c.body(null,204);
 }catch(e){return error(c,e);}});
 return app;
}
