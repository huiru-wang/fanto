import { z } from "zod";

export const recordSchema = z.object({ id: z.string().min(1), createdAt: z.string(), text: z.string(), batch: z.number().int().positive() });
export const fixtureSchema = z.object({ records: z.array(recordSchema).min(1) });
export const threadSchema = z.object({ id: z.string().min(1), title: z.string().min(1), thesis: z.string().min(1), evidence: z.array(z.string()).min(2), openEdges: z.array(z.string()), status: z.enum(["candidate", "active", "dormant"]) });
export const specialistResultSchema = z.object({ status: z.enum(["completed", "unavailable", "failed"]), summary: z.string().min(1), sourceRecordIds: z.array(z.string()), artifactPaths: z.array(z.string()), limitations: z.array(z.string()) });
export const resultSchema = z.object({ kind: z.enum(["moment", "possibility"]), content: z.string().min(1), sourceRecordIds: z.array(z.string()).min(1), artifactPaths: z.array(z.string()) });

export type Record = z.infer<typeof recordSchema>;
export type Thread = z.infer<typeof threadSchema>;
export type SpecialistResult = z.infer<typeof specialistResultSchema>;
export type Result = z.infer<typeof resultSchema>;
