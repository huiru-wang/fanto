import sharp from "sharp";
import { mediaMime, mediaObjectKey, normalizeMimeType } from "./mime.js";
import { PostgresMediaRepository, type MediaAsset } from "./postgres-repository.js";
import { generateThumbnail, inspectImage, InvalidImageError, storedThumbnail, thumbnailObjectKey, ThumbnailWork, type MediaVariant } from "./image-thumbnail.js";
import { StorageError, type ObjectMetadata, type ObjectStorage } from "../../infrastructure/clients/storage/object-storage.js";
import { sql, type Transaction, type Kysely } from "kysely";
import type { DB } from "../../infrastructure/database/schema.js";
import { logWarn } from "../../infrastructure/logging/logger.js";

export class MediaService {
  private readonly thumbnailWork = new ThumbnailWork();
  constructor(private readonly media: PostgresMediaRepository, private readonly oss: ObjectStorage) {}
  static create(db: Kysely<DB>, oss: ObjectStorage) { return new MediaService(new PostgresMediaRepository(db), oss); }
  /** Durable cleanup survives the physical removal of the Fanto itself. No role tombstone. */
  async queueFantoDeletion(trx: Transaction<DB>, userId: string, fantoId: string, avatarId: string | null) {
    const assets = await trx.selectFrom("media_assets").selectAll().where("user_id", "=", userId)
      .where(sql<boolean>`(
        media_id=${avatarId} OR ext_data::jsonb->>'recordId' IN
          (SELECT record_id FROM records WHERE owner_type='fanto' AND owner_id=${fantoId})
      ) AND NOT EXISTS (SELECT 1 FROM user_fantos WHERE avatar_media_id=media_assets.media_id AND fanto_id<>${fantoId}::uuid)
        AND NOT EXISTS (SELECT 1 FROM user_profiles WHERE avatar_media_id=media_assets.media_id OR cover_media_id=media_assets.media_id)`)
      .orderBy("media_id").forUpdate().execute();
    const keys = assets.flatMap(asset => {
      const thumbnail = storedThumbnail(JSON.parse(asset.ext_data ?? "{}"), asset.object_key);
      return [asset.object_key, ...(thumbnail ? [thumbnail.objectKey] : [])];
    });
    await sql`INSERT INTO fanto_media_deletions(fanto_id,user_id,object_keys)
      VALUES(${fantoId},${userId},${JSON.stringify(keys)}::jsonb)`.execute(trx);
    if (assets.length) await trx.deleteFrom("media_assets").where("user_id", "=", userId)
      .where("media_id", "in", assets.map(asset => asset.media_id)).execute();
  }
  async finishFantoDeletion(db: Kysely<DB>, userId: string, fantoId: string): Promise<boolean> {
    const result = await sql<{object_keys:string[]}>`SELECT object_keys FROM fanto_media_deletions
      WHERE user_id=${userId} AND fanto_id=${fantoId}`.execute(db);
    if (!result.rows[0]) return true;
    try {
      for (const key of result.rows[0].object_keys) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([this.oss.remove(key),new Promise<never>((_,reject)=>{
            timer=setTimeout(()=>reject(new Error("Object deletion timed out")),2000);
          })]);
        } catch(error) {
          if (!(error instanceof StorageError && error.code === "NoSuchKey")) throw error;
        } finally {clearTimeout(timer);}
      }
      await sql`DELETE FROM fanto_media_deletions WHERE user_id=${userId} AND fanto_id=${fantoId}`.execute(db);
      return true;
    } catch {return false;}
  }
  findOwnedByIds(userId: string, ids: string[], options: { transaction?: Transaction<DB> } = {}) { return this.media.findMediaByIds(ids, userId, options.transaction, !!options.transaction); }
  static enqueueRecordDeletion(userId: string, ids: string[], transaction: Transaction<DB>) {
    return PostgresMediaRepository.enqueueRecordDeletion(userId, ids, transaction);
  }
  async deleteRecordObjects(keys: string[]): Promise<void> {
    await Promise.allSettled(keys.map(async key => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          this.oss.remove(key),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("OSS deletion timed out")), 2000);
          }),
        ]);
      } catch (error) {
        logWarn("record-delete", "Storage cleanup failed", { reason: "object_delete_failed" });
      } finally {
        if (timer) clearTimeout(timer);
      }
    }));
  }
  private prepareImage(key: string, mimeType: string, maxBytes: number, sourceData?: Buffer, sourceHead?: ObjectMetadata) {
    const deadline = Date.now() + 60_000;
    return this.thumbnailWork.run(key, async () => {
      const checkDeadline = () => { if (Date.now() >= deadline) throw new Error("Thumbnail processing timed out"); };
      checkDeadline();
      // Upload completion already checked this object: avoid a second remote HEAD.
      const source = sourceHead ?? await this.oss.head(key);
      if (!source) throw new StorageError("NoSuchKey", 404);
      if (source.bytes > maxBytes) throw new InvalidImageError();
      const data = sourceData ?? await this.oss.getObject(key, { maxBytes });
      if (data.length !== source.bytes) throw new InvalidImageError();
      const original = await inspectImage(data, mimeType, maxBytes);
      checkDeadline();
      const objectKey = thumbnailObjectKey(key);
      const existing = await this.oss.head(objectKey);
      const reusable = existing && existing.bytes > 0 && normalizeMimeType(existing.contentType) === "image/webp"
        && existing.metadata["source-etag"] === source.etag && existing.metadata["thumbnail-version"] === "1"
        && Number(existing.metadata.width) > 0 && Number(existing.metadata.height) > 0;
      let bytes: number, width: number, height: number;
      if (reusable) { bytes = existing.bytes; width = Number(existing.metadata.width); height = Number(existing.metadata.height); }
      else {
        const result = await generateThumbnail(data, mimeType, maxBytes);
        checkDeadline();
        bytes = result.data.length; width = result.width; height = result.height;
        await this.oss.putObject(objectKey, result.data, "image/webp", { metadata: { "source-etag": source.etag, "thumbnail-version": "1", width: String(width), height: String(height) } });
      }
      checkDeadline();
      return { capture: original, thumbnail: { version: 1 as const, objectKey, mimeType: "image/webp" as const, bytes, width, height, sourceEtag: source.etag } };
    });
  }
  async createUpload(userId: string, input: { mimeType: string; bytes: number; purpose?: "record" | "fanto_avatar" | "user_avatar" | "user_cover" }) {
    const descriptor = mediaMime(input.mimeType); if (!descriptor || (descriptor.mediaType === "image" && input.bytes > 10 * 1024 * 1024)) return null;
    if (["fanto_avatar", "user_avatar"].includes(input.purpose ?? "") && (descriptor.mediaType !== "image" || input.bytes > 512 * 1024)) return null;
    if (input.purpose === "user_cover" && (descriptor.mediaType !== "image" || input.bytes > 2 * 1024 * 1024)) return null;
    const mediaId = crypto.randomUUID();
    const objectKey=input.purpose === "user_cover" ? `users/${userId}/profile/cover/${mediaId}${descriptor.extension}` : input.purpose === "user_avatar" ? `users/${userId}/profile/avatar/${mediaId}${descriptor.extension}` : input.purpose === "fanto_avatar" ? `users/${userId}/fanto/avatar/${mediaId}${descriptor.extension}` : mediaObjectKey(userId,mediaId,descriptor.extension);
    const created = await this.media.create({ mediaId, userId, objectKey, mediaType: descriptor.mediaType, mimeType: descriptor.mimeType, bytes: input.bytes, purpose:input.purpose });
    const signed = await this.oss.signUpload(created.objectKey, created.mimeType, 900);
    return { mediaId: created.mediaId, uploadUrl: signed.url, expiresAt: signed.expiresAt };
  }
  async completeUpload(userId: string, id: string, capture: Record<string, unknown>) {
    const current = await this.media.findMedia(id, userId);
    if (!current || current.extData.retiredAt || current.extData.cleanupClaimedAt) return { kind: "not_found" } as const;
    if (current.status === "ready") return { kind: "ok", media: current } as const;
    try {
      const head = await this.oss.head(current.objectKey);
      if (!head) return { kind: "not_uploaded" } as const;
      if (head.bytes !== current.bytes || (current.mediaType === "image" && head.bytes > 10 * 1024 * 1024) || normalizeMimeType(head.contentType) !== current.mimeType) return { kind: "mismatch" } as const;
      if (["fanto_avatar", "user_avatar", "user_cover"].includes(String(current.extData.purpose))) {
        const cover = current.extData.purpose === "user_cover";
        const maxBytes = cover ? 2 * 1024 * 1024 : 512 * 1024;
        if (head.bytes > maxBytes || current.mediaType !== "image") return {kind:"invalid_avatar"} as const;
        const data=await this.oss.getObject(current.objectKey,{maxBytes});
        const dimensions=await inspectImage(data,current.mimeType,maxBytes);
        const info=await sharp(data,{limitInputPixels:40_000_000}).metadata();
        if ((cover ? dimensions.width * 3 !== dimensions.height * 4 || dimensions.width < 640 || dimensions.width > 1600 : dimensions.width !== dimensions.height || dimensions.width < 128 || dimensions.width > 512) || (info.pages ?? 1)>1) return {kind:"invalid_avatar"} as const;
        const result=await this.media.complete(id,userId,dimensions);
        return result ? {kind:"ok",media:result} as const : {kind:"incomplete"} as const;
      }
      const prepared = current.mediaType === "image" ? await this.prepareImage(current.objectKey, current.mimeType, 10 * 1024 * 1024, undefined, head) : undefined;
      const result = await this.media.complete(id, userId, prepared ? { ...capture, ...prepared.capture } : capture, prepared?.thumbnail);
      return result ? { kind: "ok", media: result } as const : { kind: "incomplete" } as const;
    } catch (error) {
      return error instanceof InvalidImageError || error instanceof StorageError && error.code === "ObjectTooLarge"
        ? { kind: "invalid_image" } as const : { kind: "incomplete" } as const;
    }
  }
  async cleanupAvatars(db: Kysely<DB>, apply = false) {
    const cutoff=new Date(Date.now()-24*60*60*1000).toISOString();
    const candidates=await db.selectFrom("media_assets").select(["media_id","user_id"]).where(sql<boolean>`ext_data::jsonb->>'purpose' IN ('fanto_avatar','user_avatar','user_cover')`)
      .where("created_at","<",cutoff)
      .where(sql<boolean>`NOT EXISTS (SELECT 1 FROM user_fantos WHERE avatar_media_id=media_assets.media_id) AND NOT EXISTS (SELECT 1 FROM user_profiles WHERE avatar_media_id=media_assets.media_id OR cover_media_id=media_assets.media_id)`).orderBy("media_id").limit(100).execute();
    let eligible=0,removed=0,failed=0;
    for (const candidate of candidates) {
      const claimed=await db.transaction().execute(async trx=>{
        const row=await trx.selectFrom("media_assets").selectAll().where("user_id","=",candidate.user_id).where("media_id","=",candidate.media_id).forUpdate().executeTakeFirst();
        if(!row) return null;
        if(await trx.selectFrom("user_fantos").select("user_id").where("avatar_media_id","=",row.media_id).executeTakeFirst() || await trx.selectFrom("user_profiles").select("user_id").where(eb=>eb.or([eb("avatar_media_id","=",row.media_id),eb("cover_media_id","=",row.media_id)])).executeTakeFirst()) return null;
        const data=JSON.parse(row.ext_data ?? "{}");
        if(data.cleanupClaimedAt && Date.now()-Date.parse(data.cleanupClaimedAt)<600_000) return null;
        if(apply) await trx.updateTable("media_assets").set({ext_data:JSON.stringify({...data,cleanupClaimedAt:new Date().toISOString()})}).where("user_id","=",row.user_id).where("media_id","=",row.media_id).execute();
        return row;
      });
      if(!claimed) continue;
      eligible++;
      if(!apply) continue;
      try {
        await this.oss.remove(claimed.object_key);
        await db.transaction().execute(async trx=>{
          const row=await trx.selectFrom("media_assets").select("media_id").where("user_id","=",claimed.user_id).where("media_id","=",claimed.media_id).forUpdate().executeTakeFirst();
          if(row && !await trx.selectFrom("user_fantos").select("user_id").where("avatar_media_id","=",row.media_id).executeTakeFirst() && !await trx.selectFrom("user_profiles").select("user_id").where(eb=>eb.or([eb("avatar_media_id","=",row.media_id),eb("cover_media_id","=",row.media_id)])).executeTakeFirst())
            await trx.deleteFrom("media_assets").where("user_id","=",claimed.user_id).where("media_id","=",row.media_id).execute();
        });
        removed++;
      } catch { failed++; }
    }
    return {eligible,removed,failed,dryRun:!apply};
  }
  async validateAvatar(userId: string, id: string, transaction: Transaction<DB>, purpose: "fanto_avatar" | "user_avatar" | "user_cover" = "fanto_avatar") {
    const rows=await this.media.findMediaByIds([id],userId,transaction,true);
    const asset=rows[0];
    return !!asset && asset.status === "ready" && asset.mediaType === "image" && asset.extData.purpose === purpose && !asset.extData.retiredAt && !asset.extData.cleanupClaimedAt;
  }
  async readyMetadata(userId: string, id: string) { const asset = await this.media.findMedia(id, userId); return asset?.status === "ready" && !["fanto_avatar", "user_avatar", "user_cover"].includes(String(asset.extData.purpose)) ? metadata(asset) : null; }
  async readyRecordMetadata(userId:string,id:string){
    const asset=await this.media.findRecordMedia(id,userId);
    return asset?.status==="ready"&&!asset.extData.cleanupClaimedAt&&!asset.extData.retiredAt
      &&!["fanto_avatar","user_avatar","user_cover"].includes(String(asset.extData.purpose))?metadata(asset):null;
  }
  private async resolveThumbnail(asset: MediaAsset) {
    const thumbnail = storedThumbnail(asset.extData, asset.objectKey);
    if (thumbnail) return thumbnail;
    const prepared = await this.prepareImage(asset.objectKey, asset.mimeType, 20 * 1024 * 1024);
    const saved = await this.media.saveThumbnail(asset.mediaId, asset.userId, prepared.thumbnail);
    if (!saved) { await this.oss.remove(prepared.thumbnail.objectKey).catch(() => {}); return null; }
    const savedThumbnail = storedThumbnail(saved.extData, asset.objectKey);
    if (!savedThumbnail) throw new Error("Thumbnail unavailable");
    return savedThumbnail;
  }
  async readUrl(userId: string, id: string, variant: MediaVariant = "original") {
    const asset = await this.media.findMedia(id, userId);
    if (asset?.status !== "ready" || asset.extData.cleanupClaimedAt) return null;
    let key = asset.objectKey;
    if (asset.mediaType === "image" && !["fanto_avatar", "user_avatar", "user_cover"].includes(String(asset.extData.purpose)) && variant === "thumbnail") {
      const thumbnail = await this.resolveThumbnail(asset);
      if (!thumbnail) return null;
      key = thumbnail.objectKey;
    }
    return this.oss.signRead(key, 300);
  }
  async redirectUrl(userId: string, id: string) {
    const asset = await this.media.findMedia(id, userId);
    return asset?.status === "ready" && !asset.extData.cleanupClaimedAt ? (await this.oss.signRead(asset.objectKey, 300)).url : null;
  }
}

export function metadata(asset: MediaAsset) {
  const capture = asset.extData.capture && typeof asset.extData.capture === "object"
    ? asset.extData.capture as Record<string, unknown>
    : {};
  const positive = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
  const filename = typeof asset.extData.filename === "string" ? asset.extData.filename : undefined;
  return {
    mediaId: asset.mediaId,
    mediaType: asset.mediaType,
    mimeType: asset.mimeType,
    ...(asset.mediaType === "file" ? { bytes: asset.bytes, ...(filename ? { filename } : {}) } : {}),
    ...(positive(capture.width) ? { width: positive(capture.width) } : {}),
    ...(positive(capture.height) ? { height: positive(capture.height) } : {}),
    ...(positive(capture.durationMs) ? { durationMs: positive(capture.durationMs) } : {}),
  };
}
