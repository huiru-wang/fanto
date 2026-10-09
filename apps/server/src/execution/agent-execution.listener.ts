import type { AgentExecutionQueue, AgentExecutionMessage } from "../event/agent-execution-queue.js";
import { logError } from "../infrastructure/logging/logger.js";
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
    queue.on(async message=>{if(this.stopped)return;this.pending.push(message);this.drain();});
  }
  private drain() {
    while(!this.stopped && this.active.size<this.limit && this.pending.length){
      const msg=this.pending.shift()!;
      const run=Promise.resolve().then(async()=>{
        switch(msg.type){
          case "proposal":return this.proposal?.execute(msg.userId,msg.recordId,msg.version);
          case "creator":return this.creator?.execute(msg.userId,msg.projectId,msg.proposalId);
          case "task":return this.task.execute(msg.userId,msg.taskId,msg.taskRunId);
        }
      }).catch(error=>logError("agent-execution","Agent handler failed",{type:msg.type,error:String(error)}))
        .finally(()=>{this.active.delete(run);this.drain();});
      this.active.add(run);
    }
  }
  async stop(){this.stopped=true;this.pending.length=0;await Promise.allSettled([...this.active]);}
}
