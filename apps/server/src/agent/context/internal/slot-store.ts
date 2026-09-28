export type SlotStore = {
  readonly values: Map<string, string>;
  prompt?: Promise<string>;
};

export function createSlotStore(initial: Record<string, string>): SlotStore {
  return { values: new Map(Object.entries(initial)) };
}
