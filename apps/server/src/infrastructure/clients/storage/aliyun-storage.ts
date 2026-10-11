import OSS from "ali-oss";
import type { Readable } from "node:stream";
import { logExternalCall } from "../../logging/external-call.js";
import { StorageError, type ObjectMetadata, type ObjectStorage } from "./object-storage.js";

export type AliyunStorageOptions = { region: string; endpoint?: string; bucket: string; accessKeyId: string; accessKeySecret: string };
const TIMEOUT_MS = 15_000;

export class AliyunStorage implements ObjectStorage {
  private client: any;
  constructor(options: AliyunStorageOptions) { this.client = new OSS({ ...options, timeout: TIMEOUT_MS }); }
  async signUpload(key: string, contentType: string, expiresSeconds: number) {
    return this.sign(key, { method: "PUT", expires: expiresSeconds, "Content-Type": contentType });
  }
  async signRead(key: string, expiresSeconds: number) { return this.sign(key, { method: "GET", expires: expiresSeconds }); }
  private sign(key: string, options: Record<string, unknown>) {
    try {
      const url: string = this.client.signatureUrl(key, options);
      const expiry = Number(new URL(url).searchParams.get("Expires"));
      if (!Number.isFinite(expiry) || expiry <= 0) throw new StorageError("InvalidSignature");
      return { url, expiresAt: new Date(expiry * 1000).toISOString() };
    } catch (error) { throw safeError(error); }
  }
  async putObject(key: string, data: Buffer, contentType: string, options?: { metadata?: Record<string, string> }) {
    const details: Record<string, unknown> = { bytes: data.length, contentType };
    await logExternalCall("oss", "put", details, async () => {
      try {
        const result = await this.client.put(key, data, { headers: { "Content-Type": contentType }, meta: options?.metadata, timeout: TIMEOUT_MS });
        details.httpStatus = result?.res?.status;
      } catch (error) { throw safeError(error); }
    });
  }
  async getObject(key: string, options?: { maxBytes?: number }): Promise<Buffer> {
    const details: Record<string, unknown> = {};
    return logExternalCall("oss", "get", details, async () => {
      let stream: Readable | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await this.client.getStream(key, { timeout: TIMEOUT_MS });
        details.httpStatus = result?.res?.status;
        stream = result.stream;
        if (!stream) throw new StorageError("InvalidObjectBody");
        const body = stream;
        timer = setTimeout(() => body.destroy(new StorageError("StorageTimeout")), TIMEOUT_MS);
        const chunks: Buffer[] = [];
        let bytes = 0;
        for await (const chunk of body) {
          const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          bytes += data.length;
          if (options?.maxBytes !== undefined && bytes > options.maxBytes) throw new StorageError("ObjectTooLarge");
          chunks.push(data);
        }
        details.bytes = bytes;
        return Buffer.concat(chunks, bytes);
      } catch (error) { throw safeError(error); }
      finally { if (timer) clearTimeout(timer); stream?.destroy(); }
    });
  }
  async head(key: string): Promise<ObjectMetadata | null> {
    const details: Record<string, unknown> = {};
    return logExternalCall("oss", "head", details, async () => {
      try {
        const result = await this.client.head(key, { timeout: TIMEOUT_MS });
        details.httpStatus = result?.res?.status;
        const headers = Object.fromEntries(Object.entries(result?.res?.headers ?? {}).map(([name, value]) => [name.toLowerCase(), String(value)]));
        const bytes = Number(headers["content-length"]);
        const contentType = headers["content-type"];
        const etag = headers.etag;
        if (!Number.isSafeInteger(bytes) || bytes < 0 || !contentType || !etag) throw new StorageError("InvalidObjectMetadata");
        const metadata = Object.fromEntries(Object.entries(headers).filter(([name]) => name.startsWith("x-oss-meta-")).map(([name, value]) => [name.slice(11), value]));
        return { bytes, contentType, etag, metadata };
      } catch (error) {
        const failure = safeError(error);
        if (failure.status === 404 && failure.code === "NoSuchKey") { details.httpStatus = 404; return null; }
        throw failure;
      }
    });
  }
  async remove(key: string) {
    const details: Record<string, unknown> = {};
    await logExternalCall("oss", "delete", details, async () => {
      try { const result = await this.client.delete(key, { timeout: TIMEOUT_MS }); details.httpStatus = result?.res?.status; }
      catch (error) { const failure = safeError(error); if (failure.status !== 404 || failure.code !== "NoSuchKey") throw failure; details.httpStatus = 404; }
    });
  }
}

function safeError(error: unknown): StorageError {
  if (error instanceof StorageError) return error;
  const failure = error as { code?: unknown; status?: unknown; statusCode?: unknown } | null;
  const code = typeof failure?.code === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(failure.code) ? failure.code : "StorageUnavailable";
  const status = failure?.status ?? failure?.statusCode;
  return new StorageError(code, typeof status === "number" ? status : undefined);
}
