export type ContextInput = {
  userId: string;
  sessionId: string;
  message: string;
  recentMessages: unknown[];
};

export type ContextFragment = {
  section: string;
  content: string;
};

export interface ContextProvider {
  name: string;
  build(input: ContextInput): Promise<ContextFragment>;
}
