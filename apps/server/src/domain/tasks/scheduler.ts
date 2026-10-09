import type { TaskService } from "./index.js";
import type { AgentExecutionQueue } from "../../event/agent-execution-queue.js";
import { logError, logInfo } from "../../infrastructure/logging/logger.js";
export class TaskScheduler {
  private timer:ReturnType<typeof setInterval>|undefined;
  private ticking=false;
  private wakePending=false;
  constructor(private readonly tasks:TaskService,private readonly queue:AgentExecutionQueue,private readonly intervalMs:number){
    if(!Number.isInteger(intervalMs)||intervalMs<1)throw Error("Invalid scheduler interval");
  }
  start(){if(this.timer)return;this.timer=setInterval(()=>this.wake(),this.intervalMs);this.timer.unref?.();this.wake();}
  stop(){if(this.timer){clearInterval(this.timer);this.timer=undefined;}}
  wake(){
    if (this.ticking) {this.wakePending=true;return;}
    void this.tick().catch(error=>logError("task-scheduler","Tick failed",{error:String(error)}));
  }
  async tick(now=new Date()):Promise<void>{
    if(this.ticking)return;this.ticking=true;
    try{
      const due=await this.tasks.dueTasks(now,100);
      for(const task of due){
        const run=await this.tasks.startDueRun(task,now);
        if(!run)continue;
        this.queue.publish({type:"task",userId:task.userId,taskId:task.taskId,taskRunId:run.runId});
        logInfo("task-scheduler","run_queued",{taskId:task.taskId,runId:run.runId});
      }
    }finally{
      this.ticking=false;
      if(this.wakePending){this.wakePending=false;this.wake();}
    }
  }
}
