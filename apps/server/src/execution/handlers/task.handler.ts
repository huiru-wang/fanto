import type { AgentRuntime } from "../../agent/agent-runtime.js";
import type { TaskService } from "../../domain/tasks/index.js";
import { renderTaskBrief, taskTimeZone, taskTraceId } from "./task-brief.js";
import type { AgentWorker } from "../agent-worker.js";

export class TaskHandler {
  constructor(private readonly tasks:TaskService,private readonly agent:AgentRuntime,private readonly worker:AgentWorker){}
  async execute(userId:string,taskId:string,runId:string) {
    const claimed=await this.tasks.claimRun(userId,taskId,runId);
    if(!claimed)return;
    try {
      const task=await this.tasks.find(userId,taskId);
      if(!task)throw Error("TASK_NOT_FOUND");
      const definition=this.agent.registry.get(task.agentId);
      if(!definition?.task?.enabled || definition.id==="main")throw Error("TASK_AGENT_UNAVAILABLE");
      const session=await this.agent.sessions.create(definition,userId);
      let handedOff=false;
      try {
        const bound=await this.tasks.rebindRunWorkerSession(userId,taskId,runId,session.id);
        if(!bound)throw Error("TASK_RUN_SESSION_BIND_FAILED");
        handedOff=true;
        await this.worker.run(session,renderTaskBrief(task),task.timeoutSeconds*1000,{
          traceId:taskTraceId(task),timeZone:taskTimeZone(task),task:{taskId,taskRunId:runId},taskPlanReady:Boolean(bound.plan)
        });
      }finally{
        if(!handedOff)await this.agent.sessions.release(session.id).catch(()=>{});
      }
      const current=await this.tasks.findRun(userId,taskId,runId);
      if(current?.status==="completed")return;
      if(current?.status==="running")await this.tasks.failRun(current,{code:"TASK_RESULT_NOT_DELIVERED",message:"Task Agent finished without deliver_task_result"});
    } catch(error) {
      const current=await this.tasks.findRun(userId,taskId,runId);
      if(current?.status==="running")await this.tasks.failRun(current,{code:"TASK_EXECUTION_FAILED",message:error instanceof Error?error.message:String(error)});
      throw error;
    }
  }
}
