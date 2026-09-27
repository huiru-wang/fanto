import { z } from "zod";

const imageBlock = z.object({
  type: z.literal("image"),
  mediaId: z.string(),
  description: z.string().optional(),
}).strict();

const audioBlock = z.object({
  type: z.literal("audio"),
  mediaId: z.string(),
  transcription: z.string().optional(),
}).strict();

const recordContent = z.object({
  text: z.string(),
  blocks: z.array(z.union([imageBlock, audioBlock])),
}).strict();

export const recordSchema = z.object({
  id: z.string(),
  userId: z.string(),
  source: z.string(),
  content: recordContent,
  version: z.number().int(),
  status: z.enum(["pending", "updated", "processing", "processed"]),
  eventAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).passthrough();

export const recordListSchema = z.object({
  data: z.array(recordSchema),
  hasMore: z.boolean(),
  nextCursor: z.string().nullable(),
  pageSize: z.number().int(),
}).strict();

export const recordSearchSchema = z.object({
  data: z.array(z.object({
    recordId: z.string(),
    sourceType: z.enum(["record_text", "image", "audio"]),
    mediaId: z.string().nullable(),
    snippet: z.string(),
    distance: z.number(),
    eventAt: z.string(),
  }).strict()),
}).strict();

export const preferenceCategorySchema = z.enum(["communication", "scenario", "lifestyle"]);

export const preferenceSchema = z.object({
  preferenceId: z.string(),
  userId: z.string(),
  category: preferenceCategorySchema,
  content: z.string(),
  sourceSessionId: z.string(),
  sourceMessageId: z.string(),
  sourceQuote: z.string(),
  version: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).strict();

export const preferenceListSchema = z.object({ data: z.array(preferenceSchema).max(20) }).strict();
export const preferenceCreateSchema = z.object({ preference: preferenceSchema, reused: z.boolean() }).strict();
export const preferenceDeleteSchema = z.object({ preferenceId: z.string() }).strict();

export const mediaMetadataSchema = z.object({
  mediaId: z.string(),
  mediaType: z.enum(["image", "audio"]),
  mimeType: z.string(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  durationMs: z.number().int().positive().optional(),
}).strict();

export type FantoRecord = z.infer<typeof recordSchema>;
export type FantoRecordList = z.infer<typeof recordListSchema>;
export type FantoRecordSearch = z.infer<typeof recordSearchSchema>;
export type FantoMediaMetadata = z.infer<typeof mediaMetadataSchema>;
export type FantoPreference = z.infer<typeof preferenceSchema>;
export type FantoPreferenceList = z.infer<typeof preferenceListSchema>;
export type FantoPreferenceCategory = z.infer<typeof preferenceCategorySchema>;
