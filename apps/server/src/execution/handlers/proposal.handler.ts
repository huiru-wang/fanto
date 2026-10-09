import type { AgentRuntime } from "../../agent/agent-runtime.js";
import type { RecordService } from "../../domain/records/index.js";
import type { AgentWorker } from "../agent-worker.js";

export class ProposalHandler {
  constructor(private readonly records:RecordService,private readonly agent:AgentRuntime,
    private readonly worker:AgentWorker,private readonly timeoutMs:number){}
  async execute(userId:string,recordId:string,version:number) {
    const [source]=await this.records.findMany(userId,[recordId]);
    if(!source || source.version!==version || source.status!=="processed")return;
    const definition=this.agent.registry.get("proposal-agent");
    if(!definition)throw Error("PROPOSAL_AGENT_UNAVAILABLE");
    const session=await this.agent.sessions.create(definition,userId,{internal:true});
    await this.worker.run(session,"完整理解当前 Record；仅在确有创意价值时保存一份包含 1–2 个候选的 Proposal，否则回复 no_proposal。不要询问用户。",
      this.timeoutMs,{creative:{role:"proposal",recordId,recordVersion:version}});
  }
}
