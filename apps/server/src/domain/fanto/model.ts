import {z} from "zod";
export type CharacterPrompt={character:string;scenario:string;instructions:string;exampleDialogues:string};
export const emptyRole=():CharacterPrompt=>({character:"",scenario:"",instructions:"",exampleDialogues:""});
export const DEFAULT_CHARACTER=emptyRole();
export const roleSchema=z.object({
  character:z.string().max(16000).nullish().transform(value=>value??""),scenario:z.string().max(16000).nullish().transform(value=>value??""),
  instructions:z.string().max(16000).nullish().transform(value=>value??""),exampleDialogues:z.string().max(16000).nullish().transform(value=>value??"")
}).strict();
export const agentConfigSchema=z.object({
  recordReadEnabled:z.boolean().default(false),fantoMemoryEnabled:z.boolean().default(true),narrationEnabled:z.boolean().default(false)
}).strict();
export type FantoAgentConfig=z.infer<typeof agentConfigSchema>;
export const defaultAgentConfig=():FantoAgentConfig=>agentConfigSchema.parse({});
export const fantoCreateSchema=z.object({
  nickname:z.string().trim().min(1).max(30),description:z.string().max(300).nullish().transform(value=>value??""),
  avatarMediaId:z.string().min(1).max(200).nullable().default(null),
  roleConfig:roleSchema.nullish().transform(value=>value??emptyRole()),agentConfig:agentConfigSchema.default({})
}).strict();
export const fantoPatchSchema=z.object({
  fantoId:z.string().uuid(),expectedVersion:z.number().int().positive(),
  changes:z.object({agentConfig:agentConfigSchema.partial().refine(value=>Object.keys(value).length>0).optional(),avatarMediaId:z.string().min(1).max(200).nullable().optional()}).strict().refine(o=>Object.keys(o).length>0)
}).strict();
export const fantoActionSchema=z.object({fantoId:z.string().uuid(),expectedVersion:z.number().int().positive()}).strict();
export type FantoSettings={
 fantoId:string;userId:string;nickname:string;description:string;avatarMediaId:string|null;
 roleConfig:CharacterPrompt;agentConfig:FantoAgentConfig;status:"active"|"archived";
 archivedAt:string|null;sessionId:string;version:number;createdAt:string;updatedAt:string;
};
export const defaultSettings=()=>({fantoId:null,nickname:"",description:"",avatarMediaId:null,sessionId:null,
 roleConfig:emptyRole(),agentConfig:defaultAgentConfig(),version:0,createdAt:null,updatedAt:null});
export type SettingsChanges=z.infer<typeof fantoPatchSchema>["changes"];
export const settingsPatchSchema=fantoPatchSchema;
export class FantoError extends Error {
 constructor(readonly code:"NOT_FOUND"|"VERSION_CONFLICT"|"INVALID_AVATAR"|"FANTO_LIMIT_REACHED"|"FANTO_BUSY"|"INVALID_STATE"|"FANTO_NAME_TAKEN"|"FANTO_DEFAULT_PROTECTED",readonly status:404|409|422){
 super(code);
 }
}
