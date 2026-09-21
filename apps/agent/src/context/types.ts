export type ContextMessage = {
  role: "user" | "assistant";
  text: string;
};

export type ContextInput = {
  userId: string;
  sessionId: string;
  message: string;
  recentMessages: ContextMessage[];
  signal?: AbortSignal;
  traceId?: string;
};

export type ContextFragment = {
  section: "Character" | "User Preferences" | "Relevant Memory";
  content: string;
};

export interface ContextProvider {
  name: string;
  build(input: ContextInput): Promise<ContextFragment>;
}
