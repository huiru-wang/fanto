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
const changeSchema = z.object({
  kind: z.enum(["enrich", "correct", "refine", "continue"]),
  title: text(40), idea: text(240), tags: proposalTagsSchema, instruction: text(3000),
}).strict();
const proposalBase = { title: text(200), recordIds: z.array(uuid).min(1).max(100).transform(ids => [...new Set(ids)]) };
export const createProposalSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("create"), ...proposalBase,
    targetProjectId: z.null().optional(), proposedSummary: text(2000),
    content: z.object({ reason: text(10000), ideas: z.array(ideaSchema).min(1).max(2) }).strict(),
  }).strict(),
  z.object({ type: z.literal("extend"), ...proposalBase,
    targetProjectId: uuid, proposedSummary: z.null().optional(),
    content: z.object({ reason: text(10000), change: changeSchema }).strict(),
  }).strict(),
]);
export const acceptProposalSchema = z.object({ selectedIdeaId: uuid.optional() }).strict();
export const patchSchema = z.object({ title: text(200).optional(), summary: text(2000).optional(), coverMediaId: uuid.nullable().optional(), content: z.string().optional(), goal: goalSchema.optional() }).strict().refine(v => Object.keys(v).length > 0);
export const versionSchema = z.number().int().positive();
export const proposalListSchema = paginationSchema.extend({ type: z.enum(["create", "extend"]).optional(), status: z.enum(["pending", "accepted", "rejected"]).optional(), targetProjectId: uuid.optional() });
export const projectListSchema = paginationSchema.extend({ status: z.enum(["queued","running","completed","failed","archived"]).optional() });
