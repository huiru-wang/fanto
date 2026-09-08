import { Hono } from "hono";
import { z } from "zod";
import { parseSaveRecord } from "../domain/record-content.js";
import type { LocalMediaQueue } from "../infrastructure/local-media-queue.js";
import type { SqliteMediaRepository } from "../infrastructure/repositories/sqlite-media.repository.js";
import { decodeRecordCursor, encodeRecordCursor } from "../modules/record/record-cursor.js";
import type { RecordRepository } from "../modules/record/record.repository.js";

const input = z.object({ text: z.string(), media: z.array(z.unknown()), source: z.string().max(100).optional(), expectedVersion: z.number().int().positive().optional() }).strict();
const userId = (request: Request) => request.headers.get("x-user-id") ?? "default-user";

async function view(record: any, media: SqliteMediaRepository) {
  const assets = await media.findMediaByIds(record.content.blocks.map((block: any) => block.mediaId), record.userId); const byId = new Map(assets.map(asset => [asset.id, asset]));
  return { ...record, media: record.content.blocks.flatMap((block: any) => { const asset = byId.get(block.mediaId); if (!asset) return []; const capture = asset.extData.capture as { durationMs?: number | null } | undefined; return [asset.mediaType === "image" ? { id: asset.id, type: "image", url: `/api/media/${asset.id}`, description: block.description ?? null } : { id: asset.id, type: "audio", url: `/api/media/${asset.id}`, durationMs: capture?.durationMs ?? null, transcriptPreview: block.transcript?.slice(0, 200) ?? null }]; }) };
}
function publishImages(queue: LocalMediaQueue, record: any) { for (const block of record.content.blocks) if (!("transcript" in block) && !block.description) queue.publish("image_understanding", { recordId: record.id, userId: record.userId, mediaId: block.mediaId, version: record.version }); }
function error(c: any, value: string, current?: unknown) { if (value === "not_found") return c.json({ success: false, errorCode: "NOT_FOUND", errorMsg: "Record not found" }, 404); if (value === "conflict") return c.json({ success: false, result: current ?? null, errorCode: "VERSION_CONFLICT", errorMsg: "Record was changed by another edit" }, 409); return c.json({ success: false, errorCode: "INVALID_MEDIA", errorMsg: "Media is missing, belongs to another user, or already linked" }, 400); }

export function createRecordRoutes(records: RecordRepository, media: SqliteMediaRepository, queue: LocalMediaQueue) {
  const app = new Hono();
  app.post("/", async c => { const body = input.safeParse(await c.req.json().catch(() => null)); if (!body.success) return c.json({ success: false, errorCode: "INVALID_INPUT", errorMsg: body.error.message }, 400); try { const record = await records.create({ userId: userId(c.req.raw), source: body.data.source, value: parseSaveRecord(body.data) }); if (typeof record === "string") return error(c, record); publishImages(queue, record); return c.json({ success: true, result: await view(record, media), errorCode: null, errorMsg: null }, 201); } catch (cause) { return c.json({ success: false, errorCode: "INVALID_INPUT", errorMsg: cause instanceof Error ? cause.message : "Invalid record" }, 400); } });
  app.patch("/:id", async c => { const body = input.safeParse(await c.req.json().catch(() => null)); if (!body.success || !body.data.expectedVersion) return c.json({ success: false, errorCode: "INVALID_INPUT", errorMsg: "expectedVersion is required" }, 400); try { const record = await records.updateContent(c.req.param("id"), userId(c.req.raw), { value: parseSaveRecord(body.data), expectedVersion: body.data.expectedVersion }); if (record === "conflict") { const current = await records.findById(c.req.param("id")); return error(c, record, current ? await view(current, media) : null); } if (typeof record === "string") return error(c, record); publishImages(queue, record); return c.json({ success: true, result: await view(record, media), errorCode: null, errorMsg: null }); } catch (cause) { return c.json({ success: false, errorCode: "INVALID_INPUT", errorMsg: cause instanceof Error ? cause.message : "Invalid record" }, 400); } });
  app.get("/", async c => { const cursor = c.req.query("cursor"); try { if (cursor) decodeRecordCursor(cursor); } catch { return c.json({ success: false, errorCode: "INVALID_CURSOR", errorMsg: "Invalid record cursor" }, 400); } const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 20), 1), 100); const rows = await records.findByUserId(userId(c.req.raw), { cursor, limit: limit + 1 }); const data = await Promise.all(rows.slice(0, limit).map(record => view(record, media))); return c.json({ success: true, result: { data, hasMore: rows.length > limit, nextCursor: rows.length > limit && data.at(-1) ? encodeRecordCursor(data.at(-1)) : null, pageSize: limit }, errorCode: null, errorMsg: null }); });
  app.get("/:id", async c => { const record = await records.findById(c.req.param("id")); if (!record || record.userId !== userId(c.req.raw)) return c.json({ success: false, errorCode: "NOT_FOUND", errorMsg: "Record not found" }, 404); return c.json({ success: true, result: await view(record, media), errorCode: null, errorMsg: null }); });
  return app;
}
