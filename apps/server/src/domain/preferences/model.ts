export type PreferenceCategory = "communication" | "scenario" | "lifestyle";

export type UserPreference = {
  preferenceId: string;
  userId: string;
  category: PreferenceCategory;
  content: string;
  sourceSessionId: string;
  sourceMessageId: string;
  sourceQuote: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type PreferenceSource = {
  sessionId: string;
  messageId: string;
  quote: string;
};
