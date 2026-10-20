export const userMemoryKinds = ["personal_background", "important_relationships", "current_focus", "interaction_preferences"] as const;
export const fantoMemoryKinds = ["shared_history", "relationship_state", "ongoing_threads", "personal_experiences"] as const;
export const memoryKinds = [...userMemoryKinds, ...fantoMemoryKinds] as const;
export type UserMemoryKind = typeof userMemoryKinds[number];
export type FantoMemoryKind = typeof fantoMemoryKinds[number];
export type MemoryKind = UserMemoryKind | FantoMemoryKind;
export type MemoryOwner = { ownerType: "user" | "fanto"; ownerId: string };
export function userOwner(userId: string): MemoryOwner { return {ownerType:"user",ownerId:userId}; }
export function fantoOwner(fantoId: string): MemoryOwner { return {ownerType:"fanto",ownerId:fantoId}; }
export function validMemoryKind(owner: MemoryOwner, kind: string): kind is MemoryKind {
  return (owner.ownerType === "user" ? userMemoryKinds : fantoMemoryKinds as readonly string[]).includes(kind);
}
export type Memory = MemoryOwner & { memoryId:string; kind:MemoryKind; content:string; createdAt:string; updatedAt:string };
export type MemorySearchResult = Memory & {distance:number};
