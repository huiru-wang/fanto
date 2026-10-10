import type { AgentRuntime } from "../../agent/agent-runtime.js";
import type { ProposalService } from "../../domain/projects/proposal-service.js";
import { logError, logInfo, logSummary } from "../../infrastructure/logging/logger.js";
import type { RecordService } from "../../domain/records/index.js";
import type { AgentWorker } from "../agent-worker.js";

export class ProposalHandler {
  constructor(private readonly records:RecordService,private readonly proposals:ProposalService,private readonly agent:AgentRuntime,
    private readonly worker:AgentWorker,private readonly timeoutMs:number){}
  async execute(userId:string,recordId:string,version:number) {
    const startedAt=Date.now();
    const details:Record<string,unknown>={userId,recordId,version};
    let stage="validate_record";
    logInfo("proposal", "started", details);
    try {
      const [source]=await this.records.findMany(userId,[recordId]);
      if(!source || source.version!==version || source.status!=="processed") {
        logInfo("proposal", "skipped", {...details,reason:!source?"record_not_found":source.version!==version?"record_version_changed":"record_not_processed",durationMs:Date.now()-startedAt});
        return;
      }
      stage="initialize_session";
      const definition=this.agent.registry.get("proposal-agent");
      if(!definition)throw Error("PROPOSAL_AGENT_UNAVAILABLE");
      const session=await this.agent.sessions.create(definition,userId);
      details.sessionId=session.id;
      logInfo("proposal","session created",{...details,agentId:definition.id,durationMs:Date.now()-startedAt});
      stage="agent_run";
      await this.worker.run(session,"完整理解当前 Record，先核查是否应补充或纠正已有 Project，再判断当前 Record 自身或关联素材是否支持有价值的新提议。通过 proposal_create 保存提议；无值得继续的机会时正常结束，不要求 JSON。不要询问用户。",
        this.timeoutMs,{recordId,recordVersion:version});
      stage="validate_decision";
      const created=await this.proposals.findBySession(userId,session.id);
      if(created) {
        logInfo("proposal", "decision", {...details, outcome:"succeeded", decision:created.type, targetProjectId:created.targetProjectId, proposalId:created.proposalId, reason:logSummary(created.content.reason),durationMs:Date.now()-startedAt});
      } else {
        logInfo("proposal", "decision", {...details,outcome:"succeeded",decision:"no_proposal",reason:"no_proposal_saved",durationMs:Date.now()-startedAt});
      }
    } catch(error) {
      logError("proposal", "failed", {...details,stage,error:logSummary(error),durationMs:Date.now()-startedAt});
      throw error;
    }
  }
}
