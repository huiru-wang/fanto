import { requestJson } from "./http";

export type TaskStatus = "active" | "paused" | "completed" | "cancelled";
export type TaskRunStatus = "running" | "completed" | "failed" | "cancelled";
export type TaskResultFormat = "markdown" | "text" | "html";

export type TaskTrigger =
  | { type: "immediate" }
  | {
      type: "scheduled";
      schedule:
        | { type: "once"; at: string; timezone: string }
        | { type: "recurring"; rrule: string; timezone: string; startAt: string };
    };

export type TaskOutput = { format: TaskResultFormat };

export type TaskDto = {
  taskId: string;
  title: string;
  goal: {
    objective: string;
    context?: string;
    constraints?: string[];
    successCriteria?: string[];
  };
  trigger: TaskTrigger;
  output: TaskOutput;
  status: TaskStatus;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TaskRunPlan = {
  summary: string;
  steps: Array<{ id: string; title: string; description?: string }>;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type TaskArtifactDto = {
  filename: string;
  role: "primary" | "supplementary";
  mediaId: string;
  mimeType: string;
  bytes: number;
  checksum: string;
};

export type TaskRunDto = {
  runId: string;
  taskId: string;
  status: TaskRunStatus;
  scheduledAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  plan: TaskRunPlan | null;
  result: { summary: string; artifacts: TaskArtifactDto[] } | null;
  error: { code: string; message: string } | null;
};

export type TaskArtifactPreviewDto = {
  mediaId: string;
  filename: string;
  mimeType: "text/html" | "text/markdown" | "text/plain";
  format: TaskResultFormat;
  content: string;
};

type DataResult<T> = { data: T[] };

export async function listTasks(): Promise<TaskDto[]> {
  return (await requestJson<DataResult<TaskDto>>("/api/tasks")).data;
}
export function getTask(taskId: string): Promise<TaskDto> {
  return requestJson(`/api/tasks/${encodeURIComponent(taskId)}`);
}
export async function listTaskRuns(taskId: string): Promise<TaskRunDto[]> {
  return (await requestJson<DataResult<TaskRunDto>>(`/api/tasks/${encodeURIComponent(taskId)}/runs`)).data;
}
export function getTaskRun(taskId: string, runId: string): Promise<TaskRunDto> {
  return requestJson(`/api/tasks/${encodeURIComponent(taskId)}/runs/${encodeURIComponent(runId)}`);
}
export function pauseTask(taskId: string): Promise<TaskDto> {
  return requestJson(`/api/tasks/${encodeURIComponent(taskId)}/pause`, { method: "POST" });
}
export function resumeTask(taskId: string): Promise<TaskDto> {
  return requestJson(`/api/tasks/${encodeURIComponent(taskId)}/resume`, { method: "POST" });
}
export function cancelTask(taskId: string): Promise<TaskDto> {
  return requestJson(`/api/tasks/${encodeURIComponent(taskId)}`, { method: "DELETE" });
}
export function getTaskArtifactPreview(mediaId: string): Promise<TaskArtifactPreviewDto> {
  return requestJson(`/api/tasks/artifacts/${encodeURIComponent(mediaId)}/preview`);
}
