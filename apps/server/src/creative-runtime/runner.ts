import { TODO_CONTEXT } from "@earendil-works/pi-agent-core";
import type { AgentRuntime } from "../agent/agent-runtime.js";
import { runAgent, runAgentSkill } from "../agent/harness/run.js";
import type { AgentStreamEvent } from "../agent/harness/events.js";
import { CreativeService } from "./service.js";
import { logError } from "../infrastructure/logging/logger.js";

export type CreativeRunnerConfig = { intervalMs: number; workers: number; proposalTimeoutMs: number; creatorTimeoutMs: number };
type Listener = (event: AgentStreamEvent | {type:"done"} | {type:"error"}) => void;
export class CreativeRunner {
  private timer?: ReturnType<typeof setInterval>;
  private ticking = false;
  private stopped = false;
  private proposalCursor?: string;
  private readonly active = new Map<string, Promise<void>>();
  private readonly listeners = new Map<string, Set<Listener>>();
  constructor(readonly service: CreativeService, private readonly agent: AgentRuntime, private readonly config: CreativeRunnerConfig) {}

  start() { this.stopped = false; this.timer = setInterval(() => void this.tick(), this.config.intervalMs); this.timer.unref(); void this.tick(); }
  async stop() { this.stopped = true; if(this.timer)clearInterval(this.timer); await Promise.allSettled(this.active.values()); }
  subscribe(projectId: string, listener: Listener) {
    let set = this.listeners.get(projectId);
    if (!set) { set = new Set(); this.listeners.set(projectId, set); }
    set.add(listener);
    return () => { set!.delete(listener); if(!set!.size)this.listeners.delete(projectId); };
  }
  private publish(id:string,event:Parameters<Listener>[0]) { for(const subscriber of this.listeners.get(id)??[]) subscriber(event); }
  private launch(key:string,execute:()=>Promise<void>) {
    if(this.active.has(key) || this.active.size >= this.config.workers) return;
    const promise=execute().catch(error=>logError("creative-runner","Agent execution failed",{key,error:error instanceof Error?error.message:String(error)})).finally(()=>this.active.delete(key));
    this.active.set(key,promise);
  }
  async tick() {
    if(this.ticking || this.stopped)return;
    this.ticking=true;
    try {
      for(const record of await this.service.pendingRecords(10)) {
        const key=`record:${record.user_id}:${record.record_id}:${record.version}`;
        this.launch(key,()=>this.analyzeRecord(record));
      }
      const page = await this.service.pendingProposals(this.proposalCursor);
      this.proposalCursor = page.hasMore ? page.nextCursor! : undefined;
      for(const proposal of page.data) {
        const key=`project:${proposal.resultProjectId}`;
        this.launch(key,()=>this.dispatch(proposal.userId,proposal.resultProjectId,proposal.proposalId));
      }
    } catch(error) {logError("creative-runner","Dispatch failed",{error:error instanceof Error?error.message:String(error)});}
    finally {this.ticking=false;}
  }
  private async analyzeRecord(row:{user_id:string;record_id:string;version:number}) {
    const definition=this.agent.registry.get("proposal-agent"); if(!definition)return;
    const session=await this.agent.sessions.create(definition,row.user_id,{internal:true});
    const release=this.agent.sessions.reserve(session);
    const controller=new AbortController(), timeout=setTimeout(()=>controller.abort(),this.config.proposalTimeoutMs);
    try {
      const output=await runAgentSkill(session,"creative","分析当前触发 Record；有明确创作价值时创建 Proposal，否则返回 no_proposal。全程静默，不向用户提问。",controller.signal,
        {creative:{role:"proposal",recordId:row.record_id,recordVersion:row.version}},async()=>{});
      if(output.includes("no_proposal")) await this.service.markAnalyzed(row.user_id,row.record_id,row.version);
    } finally {clearTimeout(timeout);release(); await this.agent.sessions.release(session.id);}
  }
  async ensureSession(userId:string,projectId:string) {
    const project=await this.service.projects.find(userId,projectId);
    if(!project)throw Error("PROJECT_NOT_FOUND");
    if(project.sessionId)return project.sessionId;
    const definition=this.agent.registry.get("creator-agent");
    if(!definition)throw Error("CREATOR_AGENT_UNAVAILABLE");
    const session=await this.agent.sessions.create(definition,userId,{internal:true});
    const bound=await this.service.projects.bindSession(userId,projectId,session.id);
    if(bound!==session.id) await this.agent.sessions.release(session.id);
    if(!bound)throw Error("PROJECT_SESSION_UNAVAILABLE");
    return bound;
  }
  async onAccepted(userId:string,projectId:string,proposalId:string) {
    const sessionId=await this.ensureSession(userId,projectId);
    this.launch(`project:${projectId}`,()=>this.dispatch(userId,projectId,proposalId));
    return sessionId;
  }
  async dispatch(userId:string,projectId:string,proposalId:string) {
    const sessionId=await this.ensureSession(userId,projectId);
    const definition=this.agent.registry.get("creator-agent");
    if(!definition)return;
    const session=await this.agent.sessions.acquire(definition,sessionId,userId,{internal:true});
    const previous=await session.session.findEntries({order:"desc",limit:2000},TODO_CONTEXT);
    if(previous.some(entry=>entry.type==="custom" && entry.customType==="fanto.proposal_dispatched" &&
      (entry.data as {proposalId?:string})?.proposalId===proposalId))return;
    const proposal = await this.service.proposals.find(userId,proposalId);
    const project = await this.service.projects.find(userId,projectId);
    if (proposal?.type === "create" && project?.content.trim()) {
      // An already-published creation (including a migrated legacy Project) must
      // not be started again merely because older Sessions lacked this marker.
      await session.runtime.appendCustomEntry("fanto.proposal_dispatched",{proposalId});
      return;
    }
    const release=this.agent.sessions.reserve(session);
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),this.config.creatorTimeoutMs);
    try {
      await runAgent(session,`用户接受了创作提议 ${proposalId}。先使用 project_read 读取当前 Project 的最新 goal、content 和参考记录，再执行创作，最后用 project_manage 保存作品。`,controller.signal,{projectId},
        async event=>this.publish(projectId,event));
      await session.runtime.appendCustomEntry("fanto.proposal_dispatched",{proposalId});
      this.publish(projectId,{type:"done"});
    } catch(error) {this.publish(projectId,{type:"error"});throw error;}
    finally {clearTimeout(timeout);release();await this.agent.sessions.release(session.id);}
  }
  async send(userId:string,projectId:string,message:string,signal:AbortSignal,emit:(event:AgentStreamEvent)=>Promise<void>) {
    const project=await this.service.projects.find(userId,projectId);
    if(!project?.sessionId || project.status!=="active")throw Error("PROJECT_NOT_AUTHORIZED");
    const definition=this.agent.registry.get("creator-agent"); if(!definition)throw Error("CREATOR_AGENT_UNAVAILABLE");
    const session=await this.agent.sessions.acquire(definition,project.sessionId,userId,{internal:true});
    const release=this.agent.sessions.reserve(session);
    try {
      await runAgent(session,message,signal,{projectId},async event=>{this.publish(projectId,event);await emit(event);});
      this.publish(projectId,{type:"done"});
    } catch(error) {this.publish(projectId,{type:"error"});throw error;}
    finally {release();await this.agent.sessions.release(session.id);}
  }
}
