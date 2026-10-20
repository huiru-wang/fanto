import {Hono} from "hono";
import type {FantoService} from "../domain/fanto/index.js";
import {requireUserId} from "./request-user.js";
export function createCharacterRoutes(service:FantoService){
 const app=new Hono();
 app.get("/",async c=>c.json({success:true,result:(await service.getSettings(requireUserId(c.req.raw)))?.roleConfig??null,errorCode:null,errorMsg:null}));
 // A role's identity is immutable; legacy PUT must never bypass new creation API.
 app.put("/",c=>c.json({success:false,errorCode:"CHARACTER_IMMUTABLE",errorMsg:"Create a new Fanto to change its identity."},409));
 return app;
}
