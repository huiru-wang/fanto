export type TaskStatus = "active" | "paused" | "completed" | "cancelled";
export type TaskRunStatus = "running" | "completed" | "failed" | "cancelled";
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

export type TaskSources = {
  recordIds: string[];
  mediaIds: string[];
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
  sources: TaskSources;
  extData: Record<string, unknown>;
  status: TaskStatus;
  nextRunAt: string | null;
  sourceSessionId: string | null;
  sourceMessageId: string | null;
  createdAt: string;
  updatedAt: string;
};

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
  timeoutSeconds?: number;
  result?: { format?: TaskResultFormat };
  sources?: Partial<TaskSources>;
};

export type DelegateTaskContext = {
  userId: string;
  sourceSessionId?: string;
  sourceMessageId?: string;
  traceId?: string;
  timeZone: string;
};

export type DelegateTaskResult = { taskId: string; status: "active"; nextRunAt: string };

export type UpdateTaskInput = {
  title?: string;
  goal?: TaskGoal;
  trigger?: DelegateTaskInput["trigger"];
  timeoutSeconds?: number;
  result?: { format?: TaskResultFormat };
  sources?: Partial<TaskSources>;
  status?: "active" | "paused" | "cancelled";
};
