import { createContextKey, TODO_CONTEXT, type Context, withContextValue } from "@earendil-works/pi-agent-core";
import { createSlotStore, type SlotStore } from "./internal/slot-store.js";

export type ContextMessage = { role: "user" | "assistant"; text: string };

type RunContextInput = {
  runId: string;
  userId: string;
  query: string;
  slots: Record<string, string>;
  sessionId: string;
  traceId?: string;
  timeZone?: string;
  recentMessages: readonly ContextMessage[];
  sourceMessageId?: string;
  task?: { taskId: string; taskRunId: string };
  taskPlanReady?: boolean;
};

export type RunData = Omit<RunContextInput, "slots" | "taskPlanReady"> & {
  readonly slots: SlotStore;
  taskPlanReady: boolean;
};

const runDataContextKey = createContextKey<RunData>("fanto.context.runData");

function create(input: RunContextInput): Context {
  const data: RunData = {
    ...input,
    recentMessages: [...input.recentMessages],
    slots: createSlotStore(input.slots),
    taskPlanReady: input.taskPlanReady ?? false,
  };
  return withContextValue(runDataContextKey, data, TODO_CONTEXT);
}

function read(context: Context): RunData {
  const data = context.value(runDataContextKey);
  if (!data?.userId) throw new Error("Agent run is missing user context");
  return data;
}

export const createRunContext = Object.assign(create, { read });
