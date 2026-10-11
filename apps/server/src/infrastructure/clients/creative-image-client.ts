import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import sharp from "sharp";
import { logSummary } from "../logging/logger.js";
export type ImageFailureDetails = {
  stage: string; reason: string; durationMs: number; httpStatus?: number;
  requestId?: string; vendorCode?: string; vendorMessage?: string;
  errorName?: string; error?: string; causeCode?: string;
};
export class ImageClientError extends Error {
  constructor(readonly code: string, readonly diagnostics?: ImageFailureDetails) { super(code); }
}
function failure(code: string, stage: string, startedAt: number, reason: string, error: unknown,
  response?: Response, body?: any): ImageClientError {
  const e = error as { name?: unknown; cause?: { code?: unknown } } | null;
  const clean = (value: unknown) => typeof value === "string" ? logSummary(value) : undefined;
  return new ImageClientError(code, {stage, reason, durationMs: Date.now()-startedAt,
    httpStatus: response?.status, requestId: clean(body?.request_id ?? response?.headers.get("x-request-id")),
    vendorCode: clean(body?.code), vendorMessage: clean(body?.message),
    errorName: clean(e?.name), error: error ? logSummary(error) : undefined, causeCode: clean(e?.cause?.code)});
}
export type ImageGenerationClient = {
  generate(input: { prompt: string; referenceUrls: string[]; aspectRatio?: "portrait" | "landscape" | "square" }, signal?: AbortSignal): Promise<{ recovery: string }>;
  download(recovery: string, signal?: AbortSignal): Promise<{ data: Buffer; mimeType: "image/png"; width: number; height: number }>;
};
const maxBytes = 20 * 1024 * 1024;
export class CreativeImageClient implements ImageGenerationClient {
  private readonly key: Buffer;
  constructor(private readonly options: { endpoint: string; apiKey: string; model: string; timeoutMs: number }, private readonly request: typeof fetch = fetch) {
    const endpoint = new URL(options.endpoint);
    if (endpoint.protocol !== "https:" || !/^ws-[a-z0-9]+\.cn-beijing\.maas\.aliyuncs\.com$|^dashscope\.aliyuncs\.com$/.test(endpoint.hostname)) throw new Error("Invalid creative image endpoint");
    this.key = createHash("sha256").update(options.apiKey).digest();
  }
  async generate(input: { prompt: string; referenceUrls: string[]; aspectRatio?: "portrait" | "landscape" | "square" }, signal?: AbortSignal) {
    if (input.referenceUrls.length < 1 || input.referenceUrls.length > 3) throw new ImageClientError("INVALID_REFERENCE_IMAGES");
    const startedAt = Date.now();
    const requestSignal = AbortSignal.any([AbortSignal.timeout(this.options.timeoutMs), ...(signal ? [signal] : [])]);
    let response: Response | undefined;
    let body: any;
    let stage = "request";
    try {
      response = await this.request(this.options.endpoint, { method: "POST", redirect: "error", signal: requestSignal, headers: { Authorization: `Bearer ${this.options.apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: this.options.model, input: { messages: [{ role: "user", content: [...input.referenceUrls.map(image => ({ image })), { text: input.prompt }] }] }, parameters: { n: 1, prompt_extend: true, prompt_extend_mode: "direct", watermark: false, ...(input.aspectRatio ? { size: { portrait: "1024*1536", landscape: "1536*1024", square: "1024*1024" }[input.aspectRatio] } : {}) } }) });
      stage = "response_body";
      const text = await boundedResponse(response, 1024 * 1024);
      stage = "parse_response";
      try { body = JSON.parse(text.toString("utf8")); }
      catch { if (response.ok) throw Object.assign(new Error("Invalid JSON response"), {name:"SyntaxError"}); }
      if (!response.ok) throw failure(response.status >= 500 ? "IMAGE_RESULT_UNKNOWN" : "IMAGE_GENERATION_REJECTED", "http_response", startedAt, "http_error", null, response, body);
      stage = "validate_response";
      const images = body?.output?.choices?.flatMap((c: any) => c?.message?.content?.filter((c: any) => c?.type === "image" || c?.image).map((c: any) => c.image) ?? []) ?? [];
      if (body.code || images.length !== 1 || typeof images[0] !== "string") throw new Error("Missing single image result or vendor error");
      this.outputUrl(images[0]);
      return { recovery: this.encrypt(images[0]) };
    } catch (error) {
      if (error instanceof ImageClientError && error.diagnostics) throw error;
      const reason = signal?.aborted ? "caller_aborted" : requestSignal.aborted ? "request_timeout" : stage === "request" ? "network_error" : stage === "parse_response" ? "invalid_json" : stage === "validate_response" ? "invalid_response" : "response_read_error";
      throw failure(stage === "validate_response" ? "IMAGE_GENERATION_INVALID_RESPONSE" : "IMAGE_RESULT_UNKNOWN", stage, startedAt, reason, error, response, body);
    }
  }
  async download(recovery: string, signal?: AbortSignal) {
    const startedAt = Date.now();
    const requestSignal = AbortSignal.any([AbortSignal.timeout(60_000), ...(signal ? [signal] : [])]);
    let stage = "recovery";
    let response: Response | undefined;
    try {
      const url = this.outputUrl(this.decrypt(recovery));
      stage = "download_request";
      response = await this.request(url, { redirect: "error", signal: requestSignal });
      if (!response.ok) throw new Error("Image download HTTP error");
      stage = "download_body";
      const buffer = await boundedResponse(response, maxBytes);
      stage = "decode_image";
      const image = sharp(buffer, { limitInputPixels: 40_000_000, failOn: "warning" });
      const metadata = await image.metadata();
      if (!["png", "jpeg", "webp"].includes(metadata.format ?? "") || !metadata.width || !metadata.height || metadata.width > 8192 || metadata.height > 8192 || (metadata.pages ?? 1) > 1) throw new Error("Invalid image dimensions or format");
      const data = await image.png().toBuffer();
      if (data.length > maxBytes) throw new Error("Image too large");
      return { data, mimeType: "image/png" as const, width: metadata.width, height: metadata.height };
    } catch (error) {
      const code = error instanceof ImageClientError && stage === "recovery" ? error.code : "IMAGE_SAVE_RETRYABLE";
      const reason = signal?.aborted ? "caller_aborted" : requestSignal.aborted ? "request_timeout" : response && !response.ok ? "http_error" : stage;
      throw failure(code, stage, startedAt, reason, error, response);
    }
  }
  private outputUrl(raw: string) {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.port || !/^dashscope-[a-z0-9-]+\.oss-(accelerate|cn-[a-z0-9-]+)\.aliyuncs\.com$/.test(url.hostname)) throw new ImageClientError("IMAGE_GENERATION_INVALID_RESPONSE");
    return url.href;
  }
  private encrypt(raw: string) {
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", this.key, iv), data = Buffer.concat([cipher.update(raw, "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url");
  }
  private decrypt(raw: string) {
    try { const data = Buffer.from(raw, "base64url"), cipher = createDecipheriv("aes-256-gcm", this.key, data.subarray(0, 12)); cipher.setAuthTag(data.subarray(12, 28)); return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString("utf8"); }
    catch { throw new ImageClientError("IMAGE_RECOVERY_UNAVAILABLE"); }
  }
}
async function boundedResponse(response: Response, limit: number): Promise<Buffer> {
  if (Number(response.headers.get("content-length")) > limit || !response.body) throw new Error("Response too large");
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let bytes = 0;
  try { for (;;) { const value = await reader.read(); if (value.done) break; bytes += value.value.byteLength; if (bytes > limit) throw new Error("Response too large"); chunks.push(value.value); } }
  finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks);
}
