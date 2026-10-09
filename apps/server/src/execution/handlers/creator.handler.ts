import { TODO_CONTEXT } from "@earendil-works/pi-agent-core";
import type { AgentRuntime } from "../../agent/agent-runtime.js";
import type { CreativeService } from "../../domain/projects/creative-service.js";
import type { ProjectService, ProposalService } from "../../domain/projects/index.js";
import type { AgentWorker } from "../agent-worker.js";

export class CreatorHandler {
  constructor(private readonly projects:ProjectService,
    private readonly proposals:ProposalService,private readonly agent:AgentRuntime,
    private readonly worker:AgentWorker,private readonly timeoutMs:number){}
  async ensureSession(userId:string,projectId:string):Promise<string>{
    const project=await this.projects.find(userId,projectId);
    if(!project)throw Error("PROJECT_NOT_FOUND");
    if(project.sessionId)return project.sessionId;
    const definition=this.agent.registry.get("creator-agent");
    if(!definition)throw Error("CREATOR_AGENT_UNAVAILABLE");
    const session=await this.agent.sessions.create(definition,userId,{internal:true});
    let bound:string|null=null;
    try {
      bound=await this.projects.bindSession(userId,projectId,session.id);
      if(!bound)throw Error("PROJECT_SESSION_UNAVAILABLE");
      return bound;
    }finally {
      if(bound!==session.id)await this.agent.sessions.release(session.id).catch(()=>{});
    }
  }
  async execute(userId:string,projectId:string,proposalId:string):Promise<void>{
    const proposal=await this.proposals.find(userId,proposalId);
    if(!proposal || proposal.status!=="accepted" || proposal.resultProjectId!==projectId)return;
    if(!await this.projects.claimExecution(userId,projectId,["queued"],"running"))return;
    try {
      const definition=this.agent.registry.get("creator-agent");
      if(!definition)throw Error("CREATOR_AGENT_UNAVAILABLE");
      const initial=await this.projects.find(userId,projectId);
      if(!initial)throw Error("PROJECT_NOT_FOUND");
      const sessionId=await this.ensureSession(userId,projectId);
      const session=await this.agent.sessions.acquire(definition,sessionId,userId,{internal:true});
      let handedOff=false;
      try {
        const prior=await session.session.findEntries({order:"desc",limit:2000},TODO_CONTEXT);
        if(prior.some(e=>e.type==="custom"&&e.customType==="fanto.proposal_dispatched"&&
          (e.data as {proposalId?:string})?.proposalId===proposalId)) {
          await this.projects.finishExecution(userId,projectId,"completed");
          return;
        }
        await session.runtime.appendCustomEntry("fanto.proposal_dispatched",{proposalId});
        handedOff=true;
        await this.worker.run(session,"请按当前已确认的方向继续完成作品。",this.timeoutMs,{projectId},true);
        const current=await this.projects.find(userId,projectId);
        if(!current||current.version<=initial.version)throw Error("CREATOR_RESULT_NOT_SAVED");
        await this.projects.finishExecution(userId,projectId,"completed");
      } finally {
        if(!handedOff)await this.agent.sessions.release(session.id).catch(()=>{});
      }
    } catch(error) {
      await this.projects.finishExecution(userId,projectId,"failed");
      throw error;
    }
  }
}
