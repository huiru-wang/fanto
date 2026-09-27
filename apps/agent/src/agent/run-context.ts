import { createContextKey, TODO_CONTEXT, type Context, withContextValue } from "@earendil-works/pi-agent-core";

export type RunMetadata = {
  userId: string;
  accessToken: string;
  traceId?: string;
  timeZone?: string;
  sessionId?: string;
  currentMessage?: string;
  sourceMessageId?: string;
  systemPrompt?: string;
};

export const userIdContextKey = createContextKey<string>("fanto.agent.userId");
export const traceIdContextKey = createContextKey<string>("fanto.agent.traceId");
export const runMetadataContextKey = createContextKey<RunMetadata>("fanto.agent.runMetadata");

export function createRunContext(metadata: RunMetadata): Context {
  let context = withContextValue(runMetadataContextKey, metadata, TODO_CONTEXT);
  context = withContextValue(userIdContextKey, metadata.userId, context);
  if (metadata.traceId) context = withContextValue(traceIdContextKey, metadata.traceId, context);
  return context;
}

export function requireRunMetadata(context: Context): RunMetadata {
  const metadata = context.value(runMetadataContextKey);
  if (metadata?.userId) return metadata;
  const userId = context.value(userIdContextKey);
  if (!userId) throw new Error("Agent run is missing user context");
  throw new Error("Agent run is missing access token context");
}

export function resolveRunSystemPrompt(context: Context, fallback: string): string {
  return context.value(runMetadataContextKey)?.systemPrompt ?? fallback;
}
