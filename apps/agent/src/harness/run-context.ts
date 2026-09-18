import { createContextKey, TODO_CONTEXT, type Context, withContextValue } from "@earendil-works/pi-agent-core";

export type RunMetadata = {
  userId: string;
  taskId?: string;
  traceId?: string;
};

export const userIdContextKey = createContextKey<string>("fanto.agent.userId");
export const taskIdContextKey = createContextKey<string>("fanto.agent.taskId");
export const traceIdContextKey = createContextKey<string>("fanto.agent.traceId");

export function createRunContext(metadata: RunMetadata): Context {
  let context = withContextValue(userIdContextKey, metadata.userId, TODO_CONTEXT);
  if (metadata.taskId) context = withContextValue(taskIdContextKey, metadata.taskId, context);
  if (metadata.traceId) context = withContextValue(traceIdContextKey, metadata.traceId, context);
  return context;
}

export function requireRunMetadata(context: Context): RunMetadata {
  const userId = context.value(userIdContextKey);
  if (!userId) throw new Error("Agent run is missing user context");
  return {
    userId,
    taskId: context.value(taskIdContextKey),
    traceId: context.value(traceIdContextKey),
  };
}
