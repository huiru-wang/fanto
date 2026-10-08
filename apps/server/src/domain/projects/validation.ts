import { z } from "zod";
const text = (max: number) => z.string().trim().min(1).max(max);
export const uuid = z.string().uuid();
export const paginationSchema = z.object({ cursor: z.string().min(1).max(4096).optional(), limit: z.number().int().min(1).max(100) }).strict();
export const goalSchema = z.object({
  objective: text(4000), context: text(12000).optional(),
  constraints: z.array(text(1000)).max(20).optional(),
  successCriteria: z.array(text(1000)).max(20).optional(),
}).strict();
const proposalTagsSchema = z.array(text(12)).min(2).max(4).transform(tags => [...new Set(tags)]).refine(tags => tags.length >= 2);
const ideaSchema = z.object({ title: text(40), idea: text(240), tags: proposalTagsSchema, goal: goalSchema }).strict();
export const createProposalSchema = z.object({
  type: z.enum(["create", "extend"]), targetProjectId: uuid.nullable().optional(), title: text(200),
  proposedSummary: text(2000).nullable().optional(), recordIds: z.array(uuid).min(1).max(100).transform(ids => [...new Set(ids)]),
  content: z.object({ reason: text(10000), ideas: z.array(ideaSchema).min(1).max(2) }).strict(),
}).strict().refine(v => v.type === "create" ? v.targetProjectId == null && !!v.proposedSummary : !!v.targetProjectId && v.proposedSummary == null);
export const acceptProposalSchema = z.object({ selectedIdeaId: uuid.optional() }).strict();
export const patchSchema = z.object({ title: text(200).optional(), summary: text(2000).optional(), coverMediaId: uuid.nullable().optional(), content: z.string().optional(), goal: goalSchema.optional() }).strict().refine(v => Object.keys(v).length > 0);
export const versionSchema = z.number().int().positive();
export const proposalListSchema = paginationSchema.extend({ type: z.enum(["create", "extend"]).optional(), status: z.enum(["pending", "accepted", "rejected"]).optional(), targetProjectId: uuid.optional() });
export const projectListSchema = paginationSchema.extend({ status: z.enum(["active", "archived"]).optional() });
