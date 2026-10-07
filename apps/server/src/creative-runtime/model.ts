import { z } from "zod";
export type CreativeAuthority = { role: "proposal"; analysisRunId: string; leaseToken: string } | { role: "creator"; creationRunId: string; leaseToken: string };
export type CreativeContext = { userId: string; sessionId?: string; creative?: CreativeAuthority; signal?: AbortSignal };
export const imageInputSchema = z.object({ imageIndex: z.number().int().min(1).max(3), prompt: z.string().trim().min(1).max(6000), referenceMediaIds: z.array(z.string().uuid()).min(1).max(3), aspectRatio: z.enum(["portrait", "landscape", "square"]).optional() }).strict();
export type ImageInput = z.infer<typeof imageInputSchema>;
export const publishInputSchema = z.object({ expectedVersion: z.number().int().positive(), markdown: z.string().min(1), summary: z.string().trim().min(1).max(2000), coverMediaId: z.string().uuid().optional() }).strict();
export type PublishInput = z.infer<typeof publishInputSchema>;
export type GeneratedImage = { mediaId: string; imageIndex: number; mimeType: string; width: number; height: number };
export class CreativeError extends Error { constructor(readonly code: string) { super(code); } }
export const fail = (code: string): never => { throw new CreativeError(code); };
export const isInternalAgent = (id: string) => ["proposal-agent", "creator-agent"].includes(id);

export const prepareInputSchema = z.object({
  sourceMediaIds: z.array(z.string().uuid()).min(1).max(3).refine(ids => new Set(ids).size === ids.length),
  subjectMediaId: z.string().uuid(), imageCount: z.number().int().min(1).max(3),
}).strict().refine(v => v.sourceMediaIds.includes(v.subjectMediaId));
export type PrepareInput = z.infer<typeof prepareInputSchema>;
export type CreationExecutionPlan = {
  sourceMediaIds: string[]; subject: { mediaId: string; description: string };
  imageCount: number; composition: "create" | "append";
};
