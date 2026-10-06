import { z } from "zod";

const location = z.object({
  name: z.string().trim().min(1).max(200),
  countryCode: z.string().trim().regex(/^[A-Za-z]{2}$/).optional(),
  country: z.string().trim().min(1).max(100).optional(),
  province: z.string().trim().min(1).max(100).optional(),
  city: z.string().trim().min(1).max(100).optional(),
  district: z.string().trim().min(1).max(100).optional(),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
}).strict();

export const SaveRecordSchema = z.object({ text: z.string().max(20_000), media: z.array(z.object({ mediaId: z.string().uuid() }).strict()).max(4), location: location.nullable().optional() }).strict().superRefine((value, ctx) => {
  if (!value.text.trim() && value.media.length === 0) ctx.addIssue({ code: "custom", message: "text and media cannot both be empty" });
  if (new Set(value.media.map((item) => item.mediaId)).size !== value.media.length) ctx.addIssue({ code: "custom", message: "mediaId must be unique" });
});
export type SaveRecordContent = z.infer<typeof SaveRecordSchema>;
export function parseSaveRecord(value: unknown): SaveRecordContent { return SaveRecordSchema.parse(value); }
