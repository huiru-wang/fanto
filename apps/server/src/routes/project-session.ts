import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type { ProjectService } from "../domain/projects/index.js";
import type { AgentRuntime } from "../agent/agent-runtime.js";
import type { CreativeRunner } from "../creative-runtime/runner.js";
import { projectHistory } from "../agent/presentation.js";
import { writeStreamEvent } from "./agent/stream.js";
import { requireUserId } from "./request-user.js";
import type { AgentStreamEvent } from "../agent/harness/events.js";

export function createProjectSessionRoutes(projects: ProjectService, agent: AgentRuntime, runner: CreativeRunner) {
  const app=new Hono();
  const bound=async(userId:string,id:string)=>{
    const project=await projects.find(userId,id);
    if(!project?.sessionId) return null;
    return project;
  };
  app.post("/projects/:id/session/start", async c => {
    const userId = requireUserId(c.req.raw), id = c.req.param("id");
    const project = await projects.find(userId, id);
    if (!project) return c.json({success:false,result:null,errorCode:"NOT_FOUND"},404);
    if (project.status !== "active") return c.json({success:false,result:null,errorCode:"INVALID_STATE"},409);
    try {
      const sessionId = await runner.startAcceptedProject(userId, id);
      return c.json({success:true,result:{projectId:id,sessionId},errorCode:null,errorMsg:null});
    } catch { return c.json({success:false,result:null,errorCode:"PROJECT_SESSION_UNAVAILABLE",errorMsg:"请重试启动创作"},503); }
  });
  app.get("/projects/:id/session/history",async c=>{
    const userId=requireUserId(c.req.raw),project=await bound(userId,c.req.param("id"));
    if(!project)return c.json({error:"Project session not found"},404);
    const cursor=c.req.query("cursor"), limit=Number(c.req.query("limit")??20);
    if ((cursor && (!/^\d+$/.test(cursor)||!Number.isSafeInteger(Number(cursor)))) || !Number.isInteger(limit) || limit<1||limit>100) return c.json({error:"Invalid cursor or limit"},400);
    try {
      const history=await agent.sessions.history(project.sessionId!,cursor?Number(cursor):undefined,limit,userId,{internal:true});
      if(history.agentId!=="creator-agent")return c.json({error:"Invalid project agent"},403);
      const def=agent.registry.get(history.agentId)!;
      return c.json({success:true,result:{sessionId:project.sessionId,agentId:history.agentId,
        messages:projectHistory(history.entries,agent.sessions.toolsForHistory(def,project.sessionId!,userId)),
        hasMore:history.hasMore,nextCursor:history.nextCursor}});
    }catch {return c.json({error:"Session unavailable"},409);}
  });
  app.get("/projects/:id/session/events",async c=>{
    const userId=requireUserId(c.req.raw),project=await bound(userId,c.req.param("id"));
    if(!project)return c.json({error:"Project session not found"},404);
    return streamSSE(c,async stream=>{
      const unsubscribe=runner.subscribe(project.projectId,event=>{
        if ("toolCallId" in event || event.type==="delta" || event.type==="turn_start" || event.type==="message_start" || event.type==="message_end")
          void writeStreamEvent(stream,event as AgentStreamEvent).catch(()=>{});
        else void stream.writeSSE({event:event.type,data:"{}"}).catch(()=>{});
      });
      const ticker=setInterval(()=>void stream.write(": ping\n\n").catch(()=>{}),15000);
      try {
        await new Promise<void>(resolve=>stream.onAbort(resolve));
      }finally{clearInterval(ticker);unsubscribe();}
    });
  });
  app.post("/projects/:id/session/stream",async c=>{
    const userId=requireUserId(c.req.raw),project=await bound(userId,c.req.param("id"));
    if(!project)return c.json({error:"Project session not found"},404);
    const input=z.object({message:z.string().trim().min(1).max(20000)}).strict().safeParse(await c.req.json().catch(()=>null));
    if(!input.success)return c.json({error:"Invalid message"},400);
    if(project.status!=="active")return c.json({error:"Project archived"},409);
    return streamSSE(c,async stream=>{
      const controller=new AbortController();
      stream.onAbort(()=>controller.abort());
      const timeout=setTimeout(()=>controller.abort(),120000);
      try {
        await stream.writeSSE({event:"start",data:JSON.stringify({sessionId:project.sessionId,agentId:"creator-agent"})});
        await runner.send(userId,project.projectId,input.data.message,controller.signal,
          event=>writeStreamEvent(stream,event));
        await stream.writeSSE({event:"done",data:"{}"});
      }catch(error){if(!stream.aborted)await stream.writeSSE({event:"error",data:JSON.stringify({error:error instanceof Error?error.message:"Agent run failed"})});}
      finally{clearTimeout(timeout);}
    });
  });
  return app;
}
