import type { AgentRuntime } from "../../agent/agent-runtime.js";
import type { ProposalService } from "../../domain/projects/proposal-service.js";
import { logInfo, logWarn } from "../../infrastructure/logging/logger.js";
import type { RecordService } from "../../domain/records/index.js";
import type { AgentWorker } from "../agent-worker.js";

export class ProposalHandler {
  constructor(private readonly records:RecordService,private readonly proposals:ProposalService,private readonly agent:AgentRuntime,
    private readonly worker:AgentWorker,private readonly timeoutMs:number){}
  async execute(userId:string,recordId:string,version:number) {
    const [source]=await this.records.findMany(userId,[recordId]);
    if(!source || source.version!==version || source.status!=="processed")return;
    const definition=this.agent.registry.get("proposal-agent");
    if(!definition)throw Error("PROPOSAL_AGENT_UNAVAILABLE");
    const session=await this.agent.sessions.create(definition,userId);
    const output=await this.worker.run(session,"完整理解当前 Record，先核查是否应补充或纠正已有 Project，再判断是否需要新提议。允许对任意生活、职业、情绪、学习、思考等记录做有价值的延续；无实质变化则输出 no_proposal。不要询问用户。",
      this.timeoutMs,{recordId,recordVersion:version});
    const created=await this.proposals.findBySession(userId,session.id);
    if(created) {
      logInfo("proposal", "decision", {recordId, sessionId:session.id, decision:created.type, targetProjectId:created.targetProjectId, proposalId:created.proposalId});
    } else {
      let value:unknown;
      try {value=JSON.parse(output.trim());} catch {value=null;}
      if(typeof value === "object" && value !== null && "decision" in value && value.decision === "no_proposal" && "reason" in value && typeof value.reason === "string" && value.reason.trim()) {
        logInfo("proposal", "decision", {recordId,sessionId:session.id,decision:"no_proposal"});
      } else {
        logWarn("proposal", "invalid decision; inspect agent session", {recordId,sessionId:session.id});
        throw Error("PROPOSAL_DECISION_INVALID");
      }
    }
  }
}
