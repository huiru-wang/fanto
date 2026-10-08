import { z } from "zod";
export type CreativeContext = { userId: string; sessionId?: string; projectId?: string; creative?: { role: "proposal"; recordId: string; recordVersion: number }; signal?: AbortSignal };
export class CreativeError extends Error { constructor(readonly code: string) { super(code); } }
export const isInternalAgent = (id: string) => ["proposal-agent", "creator-agent"].includes(id);
export const imageInputSchema = z.object({
  prompt: z.string().trim().min(1).max(6000),
  referenceMediaIds: z.array(z.string().uuid()).min(1).max(10),
  aspectRatio: z.enum(["portrait", "landscape", "square"]).optional(),
}).strict();
export type ImageInput = z.infer<typeof imageInputSchema>;
const goal = z.object({ objective: z.string().trim().min(1).max(4000), context: z.string().optional(),
  constraints: z.array(z.string()).max(20).optional(), successCriteria: z.array(z.string()).max(20).optional() }).strict();
export const projectManageSchema = z.discriminatedUnion("action", [
  z.object({action:z.literal("create"),title:z.string(),summary:z.string(),goal,content:z.string().optional(),coverMediaId:z.string().uuid().nullable().optional()}).strict(),
  z.object({action:z.literal("update"),projectId:z.string().uuid(),expectedVersion:z.number().int().positive(),
  title:z.string().optional(),summary:z.string().optional(),goal:goal.optional(),content:z.string().optional(),
  coverMediaId:z.string().uuid().nullable().optional()}).strict(),
]);
export type ProjectManageInput = z.infer<typeof projectManageSchema>;
