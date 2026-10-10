import type { AgentExecutionQueue, AgentExecutionMessage } from "../event/agent-execution-queue.js";
import { logError, logInfo, logSummary } from "../infrastructure/logging/logger.js";
import type { ProposalHandler } from "./handlers/proposal.handler.js";
import type { CreatorHandler } from "./handlers/creator.handler.js";
import type { TaskHandler } from "./handlers/task.handler.js";

export class AgentExecutionListener {
  private readonly pending:AgentExecutionMessage[]=[];
  private readonly active=new Set<Promise<void>>();
  private stopped=false;
  constructor(private readonly queue:AgentExecutionQueue,private readonly limit:number,
    private readonly proposal:ProposalHandler|undefined,private readonly creator:CreatorHandler|undefined,
    private readonly task:TaskHandler) {
    if(!Number.isInteger(limit)||limit<1)throw Error("Invalid agent concurrency");
    queue.on(async message=>{if(this.stopped){logInfo("agent-execution","skipped",{...message,reason:"listener_stopped"});return;}this.pending.push(message);this.drain();});
  }
  private drain() {
    while(!this.stopped && this.active.size<this.limit && this.pending.length){
      const msg=this.pending.shift()!;
      const run=Promise.resolve().then(async()=>{
        switch(msg.type){
          case "proposal":
            if(!this.proposal){logInfo("proposal","skipped",{...msg,reason:"creative_disabled"});return;}
            return this.proposal.execute(msg.userId,msg.recordId,msg.version);
          case "creator":
            if(!this.creator){logInfo("creator","skipped",{...msg,reason:"creative_disabled"});return;}
            return this.creator.execute(msg.userId,msg.projectId,msg.proposalId);
          case "task":return this.task.execute(msg.userId,msg.taskId,msg.taskRunId);
        }
      }).catch(error=>logError("agent-execution","Agent handler failed",{...msg,error:logSummary(error)}))
        .finally(()=>{this.active.delete(run);this.drain();});
      this.active.add(run);
    }
  }
  async stop(){this.stopped=true;for(const msg of this.pending)logInfo("agent-execution","skipped",{...msg,reason:"listener_stopped"});this.pending.length=0;await Promise.allSettled([...this.active]);}
}
