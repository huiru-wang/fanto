import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { Readable } from "node:stream";
import { logExternalCall } from "../../logging/external-call.js";
import { StorageError, type ObjectMetadata, type ObjectStorage } from "./object-storage.js";

export type R2StorageOptions = { endpoint: string; bucket: string; accessKeyId: string; accessKeySecret: string };
const TIMEOUT_MS = 15_000;

export class R2Storage implements ObjectStorage {
  private readonly client: S3Client;
  private readonly bucket: string;
  constructor(options: R2StorageOptions) {
    this.bucket = options.bucket;
    this.client = new S3Client({
      region: "auto", endpoint: options.endpoint, forcePathStyle: true,
      credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.accessKeySecret },
      maxAttempts: 1,
      requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED",
      requestHandler: new NodeHttpHandler({ connectionTimeout: TIMEOUT_MS, requestTimeout: TIMEOUT_MS, socketTimeout: TIMEOUT_MS }),
    });
  }
  async signUpload(key: string, contentType: string, expiresSeconds: number) {
    return this.sign(new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }), expiresSeconds);
  }
  async signRead(key: string, expiresSeconds: number) {
    return this.sign(new GetObjectCommand({ Bucket: this.bucket, Key: key }), expiresSeconds);
  }
  private async sign(command: PutObjectCommand | GetObjectCommand, expiresSeconds: number) {
    try {
      if (!Number.isInteger(expiresSeconds) || expiresSeconds < 1 || expiresSeconds > 604800) throw new StorageError("InvalidSignatureExpiry");
      // Use the same second-aligned time for the actual signature and returned expiry.
      const signingDate = new Date(Math.floor(Date.now() / 1000) * 1000);
      const url = await getSignedUrl(this.client, command, {
        expiresIn: expiresSeconds, signingDate, signableHeaders: new Set(["content-type"]),
      });
      return { url, expiresAt: new Date(signingDate.getTime() + expiresSeconds * 1000).toISOString() };
    } catch (error) { throw safeError(error); }
  }
  async putObject(key: string, data: Buffer, contentType: string, options?: { metadata?: Record<string, string> }) {
    const details: Record<string, unknown> = { provider: "cloudflare-r2", bytes: data.length, contentType };
    await logExternalCall("oss", "put", details, async () => {
      try {
        const result = await this.client.send(new PutObjectCommand({
          Bucket: this.bucket, Key: key, Body: data, ContentType: contentType, Metadata: options?.metadata,
        }), { abortSignal: AbortSignal.timeout(TIMEOUT_MS) });
        details.httpStatus = result.$metadata.httpStatusCode;
      } catch (error) { throw safeError(error); }
    });
  }
  async getObject(key: string, options?: { maxBytes?: number }): Promise<Buffer> {
    const details: Record<string, unknown> = { provider: "cloudflare-r2" };
    return logExternalCall("oss", "get", details, async () => {
      const controller = new AbortController();
      let body: Readable | undefined;
      const timer = setTimeout(() => { controller.abort(); body?.destroy(new StorageError("StorageTimeout")); }, TIMEOUT_MS);
      try {
        const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }), { abortSignal: controller.signal });
        details.httpStatus = result.$metadata.httpStatusCode;
        if (!(result.Body instanceof Readable)) throw new StorageError("InvalidObjectBody");
        body = result.Body;
        if (options?.maxBytes !== undefined && result.ContentLength !== undefined && result.ContentLength > options.maxBytes) throw new StorageError("ObjectTooLarge");
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
      finally { clearTimeout(timer); body?.destroy(); }
    });
  }
  async head(key: string): Promise<ObjectMetadata | null> {
    const details: Record<string, unknown> = { provider: "cloudflare-r2" };
    return logExternalCall("oss", "head", details, async () => {
      try {
        const result = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }), { abortSignal: AbortSignal.timeout(TIMEOUT_MS) });
        details.httpStatus = result.$metadata.httpStatusCode;
        const bytes = result.ContentLength;
        if (!Number.isSafeInteger(bytes) || bytes! < 0 || !result.ContentType || !result.ETag) throw new StorageError("InvalidObjectMetadata");
        return { bytes: bytes!, contentType: result.ContentType, etag: result.ETag,
          metadata: Object.fromEntries(Object.entries(result.Metadata ?? {}).map(([name, value]) => [name.toLowerCase(), value])) };
      } catch (error) {
        const failure = safeError(error);
        if (failure.status === 404 && failure.code === "NoSuchKey") { details.httpStatus = 404; return null; }
        throw failure;
      }
    });
  }
  async remove(key: string) {
    const details: Record<string, unknown> = { provider: "cloudflare-r2" };
    await logExternalCall("oss", "delete", details, async () => {
      try {
        const result = await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }), { abortSignal: AbortSignal.timeout(TIMEOUT_MS) });
        details.httpStatus = result.$metadata.httpStatusCode;
      } catch (error) {
        const failure = safeError(error);
        if (failure.status !== 404 || failure.code !== "NoSuchKey") throw failure;
        details.httpStatus = 404;
      }
    });
  }
}

function safeError(error: unknown): StorageError {
  if (error instanceof StorageError) return error;
  const failure = error as { name?: unknown; code?: unknown; $metadata?: { httpStatusCode?: number } } | null;
  const raw = failure?.code ?? failure?.name;
  const code = typeof raw === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(raw) && raw !== "Error" ? raw : "StorageUnavailable";
  const status = failure?.$metadata?.httpStatusCode;
  if (code === "NotFound" && status === 404) return new StorageError("NoSuchKey", 404);
  if (["AbortError", "TimeoutError", "ETIMEDOUT"].includes(code)) return new StorageError("StorageTimeout", status);
  return new StorageError(code, status);
}
