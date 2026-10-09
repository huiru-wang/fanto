export type TaskStatus = "active" | "paused" | "completed" | "cancelled";
export type TaskRunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type TaskResultFormat = "markdown" | "text" | "html";

export type TaskGoal = {
  objective: string;
  context?: string;
  constraints?: string[];
  successCriteria?: string[];
};

export type ImmediateTaskTrigger = { type: "immediate" };

export type ScheduledTaskTrigger = {
  type: "scheduled";
  schedule:
    | { type: "once"; at: string; timezone: string }
    | { type: "recurring"; rrule: string; timezone: string; startAt: string };
};

export type TaskTrigger = ImmediateTaskTrigger | ScheduledTaskTrigger;

export type TaskOutput = {
  format: TaskResultFormat;
};

export type TaskReferences = {
  recordIds: string[];
};

export type Task = {
  taskId: string;
  userId: string;
  title: string;
  goal: TaskGoal;
  agentId: string;
  timeoutSeconds: number;
  triggerType: "immediate" | "scheduled";
  trigger: TaskTrigger;
  output: TaskOutput;
  references: TaskReferences;
  extData: Record<string, unknown>;
  status: TaskStatus;
  nextRunAt: string | null;
  sourceSessionId: string | null;
  sourceMessageId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TaskRunPlanStep = {
  id: string;
  title: string;
  description?: string;
};

export type TaskRunPlan = {
  summary: string;
  steps: TaskRunPlanStep[];
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type TaskRunPlanInput = {
  summary: string;
  steps: TaskRunPlanStep[];
};

export type TaskPlanAction = "create" | "update";

export type TaskRunArtifact = {
  filename: string;
  role: "primary" | "supplementary";
  mediaId: string;
  mimeType: string;
  bytes: number;
  checksum: string;
};

export type TaskRunResult = {
  summary: string;
  artifacts: TaskRunArtifact[];
};

export type TaskRun = {
  runId: string;
  taskId: string;
  userId: string;
  status: TaskRunStatus;
  scheduledAt: string;
  workerSessionId: string | null;
  resultMediaId: string | null;
  result: TaskRunResult | null;
  error: Record<string, unknown> | null;
  extData: Record<string, unknown>;
  plan: TaskRunPlan | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TaskAgentPolicy = {
  defaultTimeoutSeconds: number;
  maxTimeoutSeconds: number;
};

export type DelegateTaskInput = {
  title: string;
  agentId: string;
  goal: TaskGoal;
  trigger:
    | ImmediateTaskTrigger
    | {
        type: "scheduled";
        schedule:
          | { type: "once"; at: string; timezone: string }
          | { type: "recurring"; rrule: string; timezone: string; startAt?: string };
      };
  output: TaskOutput;
  references?: Partial<TaskReferences>;
  timeoutSeconds?: number;
};

export type DelegateTaskContext = {
  userId: string;
  sourceSessionId?: string;
  sourceMessageId?: string;
  traceId?: string;
  timeZone: string;
};

export type DelegateTaskResult = {
  taskId: string;
  title: string;
  status: "active";
  trigger: TaskTrigger;
  nextRunAt: string;
  output: TaskOutput;
};

export type UpdateTaskInput = {
  title?: string;
  goal?: TaskGoal;
  trigger?: DelegateTaskInput["trigger"];
  output?: TaskOutput;
  references?: Partial<TaskReferences>;
  status?: "active" | "paused" | "cancelled";
};
