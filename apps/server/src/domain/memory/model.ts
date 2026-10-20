export const memoryKinds = ["personal_background", "important_relationships", "current_focus", "interaction_preferences", "shared_history"] as const;

export type MemoryKind = typeof memoryKinds[number];

export type Memory = {
  memoryId: string;
  userId: string;
  kind: MemoryKind;
  content: string;
  createdAt: string;
  updatedAt: string;
};

export type MemorySearchResult = Memory & { distance: number };
