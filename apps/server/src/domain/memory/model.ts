export const memoryKinds = ["profile", "goal", "guidance"] as const;

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
