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
    const session=await this.agent.sessions.create(definition,userId);
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
      const session=await this.agent.sessions.acquire(definition,sessionId,userId);
      let handedOff=false;
      try {
        const prior=await session.session.findEntries({order:"desc",limit:2000},TODO_CONTEXT);
        if(prior.some(e=>e.type==="custom"&&e.customType==="fanto.proposal_applied"&&
          (e.data as {proposalId?:string})?.proposalId===proposalId)) {
          await this.projects.finishExecution(userId,projectId,"completed");
          return;
        }
        const selected=proposal.content.ideas.find(idea=>idea.id===proposal.content.selectedIdeaId);
        if (!selected) throw Error("ACCEPTED_PROPOSAL_MISSING_SELECTION");
        const references=await this.proposals.recordsPage(userId,proposalId,{limit:100});
        if (references.kind === "error") throw Error(references.code);
        const referenceIds=references.data.data.map(record=>record.id);
        if (!referenceIds.length) throw Error("ACCEPTED_PROPOSAL_RECORDS_UNAVAILABLE");
        const sourceDirective=`\n本次确认的 Record IDs：${referenceIds.join(", ")}。在创作前用 record_read 按每批不超过5条读取所需新增素材；不能只依赖 project_read 的最近5条关联记录。`;
        const directive = proposal.type === "extend"
          ? `用户接受了一条针对现有 Project 的增量修改提议。请保留原有 goal 和有价值的已有内容，只进行以下明确的改变。\n类型：${proposal.content.change?.kind ?? "enrich"}\n作品变化：${selected.title}。${selected.idea}\n具体变更要求：${proposal.content.change?.instruction ?? selected.idea}\n请读取最新 Project 和关联 Record，合并更新而不是重新制作独立作品。${sourceDirective}`
          : `用户已接受新作品的命题：${selected.title}。${selected.idea}。\n目标：${JSON.stringify(selected.goal)}。\n请围绕此命题创作并检查实际成果。${sourceDirective}`;
        handedOff=true;
        await this.worker.run(session,directive,this.timeoutMs,{projectId},true,undefined,async () => {
          const current=await this.projects.find(userId,projectId);
          if(!current||current.version<=initial.version)throw Error("CREATOR_RESULT_NOT_SAVED");
          await session.runtime.appendCustomEntry("fanto.proposal_applied",{proposalId});
        });
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
