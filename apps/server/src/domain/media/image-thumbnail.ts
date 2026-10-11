import sharp from "sharp";
import { normalizeMimeType } from "./mime.js";

export type MediaVariant = "original" | "thumbnail";
export type Thumbnail = { version: 1; objectKey: string; mimeType: "image/webp"; bytes: number; width: number; height: number; sourceEtag: string };
export class InvalidImageError extends Error { constructor() { super("Invalid image"); this.name = "InvalidImageError"; } }
export function thumbnailObjectKey(key: string) { return key.replace(/\.[^/.]+$/, "") + ".thumbnail-v1.webp"; }
export function storedThumbnail(extData: Record<string, unknown>, key: string): Thumbnail | null {
  const variants = extData.variants as { thumbnail?: Partial<Thumbnail> } | undefined;
  const value = variants?.thumbnail;
  return value?.version === 1 && value.objectKey === thumbnailObjectKey(key) && value.mimeType === "image/webp"
    && Number.isSafeInteger(value.bytes) && value.bytes! > 0 && Number.isSafeInteger(value.width) && value.width! > 0 && Number.isSafeInteger(value.height) && value.height! > 0 && typeof value.sourceEtag === "string"
    ? value as Thumbnail : null;
}
export async function inspectImage(data: Buffer, mimeType: string, maxBytes: number) {
  try {
    if (data.length > maxBytes) throw new InvalidImageError();
    const meta = await sharp(data, { limitInputPixels: 40_000_000, failOn: "warning" }).metadata();
    const expected = { "image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp" }[normalizeMimeType(mimeType) ?? ""];
    if (!expected || meta.format !== expected || !meta.width || !meta.height) throw new InvalidImageError();
    return { width: meta.autoOrient?.width ?? meta.width, height: meta.autoOrient?.height ?? meta.height };
  } catch { throw new InvalidImageError(); }
}
export async function generateThumbnail(data: Buffer, mimeType: string, maxBytes: number) {
  try {
    const original = await inspectImage(data, mimeType, maxBytes);
    const image = sharp(data, { limitInputPixels: 40_000_000, failOn: "warning" });
    const result = await image.rotate().resize({ width: 600, withoutEnlargement: true }).webp({ quality: 80 }).timeout({ seconds: 10 }).toBuffer({ resolveWithObject: true });
    return { data: result.data, width: result.info.width, height: result.info.height,
      originalWidth: original.width, originalHeight: original.height };
  } catch (error) {
    // Encoding timeout is transient; malformed/unsupported images are not.
    if (error instanceof Error && /timeout/i.test(error.message)) throw new Error("Thumbnail processing timed out");
    throw new InvalidImageError();
  }
}

/** Limits the whole fetch/encode/write operation, not just native sharp work. */
export class ThumbnailWork {
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  private readonly pending = new Map<string, Promise<unknown>>();
  run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const existing = this.pending.get(key);
    if (existing) return existing as Promise<T>;
    const task = this.execute(operation).finally(() => this.pending.delete(key));
    this.pending.set(key, task);
    return task;
  }
  private async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.active >= 2) {
      if (this.waiting.length >= 8) throw new Error("Thumbnail capacity exceeded");
      await new Promise<void>((resolve, reject) => {
        const admitted = () => { clearTimeout(timer); resolve(); };
        const timer = setTimeout(() => {
          const index = this.waiting.indexOf(admitted);
          if (index >= 0) this.waiting.splice(index, 1);
          reject(new Error("Thumbnail queue timed out"));
        }, 60_000);
        this.waiting.push(admitted);
      });
    } else this.active += 1;
    try { return await operation(); }
    finally { const next = this.waiting.shift(); if (next) next(); else this.active -= 1; }
  }
}
