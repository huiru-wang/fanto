import { z } from "zod";
const text = (max: number) => z.string().trim().min(1).max(max);
export const uuid = z.string().uuid();
export const paginationSchema = z.object({ cursor: z.string().min(1).max(4096).optional(), limit: z.number().int().min(1).max(100) }).strict();
export const creationSchema = z.object({
  objective: text(4000), context: text(12000).optional(),
  constraints: z.array(text(1000)).max(20).optional(),
  successCriteria: z.array(text(1000)).max(20).optional(),
}).strict();
export const createProposalSchema = z.object({
  type: z.enum(["create", "extend"]), targetProjectId: uuid.nullable().optional(), title: text(200),
  proposedSummary: text(2000).nullable().optional(), recordIds: z.array(uuid).min(1).max(100).transform(ids => [...new Set(ids)]),
  content: z.object({ reason: text(10000), idea: text(10000), plan: z.array(text(2000)).max(20), creation: creationSchema.optional() }).strict(),
}).strict().refine(v => v.type === "create" ? v.targetProjectId == null && !!v.proposedSummary : !!v.targetProjectId && v.proposedSummary == null);
export const patchSchema = z.object({ title: text(200).optional(), summary: text(2000).optional(), coverMediaId: uuid.nullable().optional(), content: z.string().optional() }).strict().refine(v => Object.keys(v).length > 0);
export const versionSchema = z.number().int().positive();
export const proposalListSchema = paginationSchema.extend({ type: z.enum(["create", "extend"]).optional(), status: z.enum(["pending", "accepted", "rejected"]).optional(), targetProjectId: uuid.optional() });
export const projectListSchema = paginationSchema.extend({ status: z.enum(["active", "archived"]).optional() });
