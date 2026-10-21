/** All persistent memory belongs to exactly one Fanto identity. */
export type Memory = {memoryId:string;fantoId:string;content:string;createdAt:string;updatedAt:string};
export type MemorySearchResult = Memory & {distance:number};
