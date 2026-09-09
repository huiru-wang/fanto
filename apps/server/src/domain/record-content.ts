import { z } from "zod";

export const SaveRecordSchema = z.object({ text: z.string().max(20_000), media: z.array(z.object({ mediaId: z.string().uuid() }).strict()).max(4) }).strict().superRefine((value, ctx) => {
  if (!value.text.trim() && value.media.length === 0) ctx.addIssue({ code: "custom", message: "text and media cannot both be empty" });
  if (new Set(value.media.map((item) => item.mediaId)).size !== value.media.length) ctx.addIssue({ code: "custom", message: "mediaId must be unique" });
});
export type SaveRecordContent = z.infer<typeof SaveRecordSchema>;
export function parseSaveRecord(value: unknown): SaveRecordContent { return SaveRecordSchema.parse(value); }
