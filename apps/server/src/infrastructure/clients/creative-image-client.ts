import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import sharp from "sharp";
export class ImageClientError extends Error { constructor(readonly code: string) { super(code); } }
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
    let response: Response;
    try {
      response = await this.request(this.options.endpoint, { method: "POST", redirect: "error", signal: AbortSignal.any([AbortSignal.timeout(this.options.timeoutMs), ...(signal ? [signal] : [])]), headers: { Authorization: `Bearer ${this.options.apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: this.options.model, input: { messages: [{ role: "user", content: [...input.referenceUrls.map(image => ({ image })), { text: input.prompt }] }] }, parameters: { n: 1, prompt_extend: true, prompt_extend_mode: "direct", watermark: false, ...(input.aspectRatio ? { size: { portrait: "1024*1536", landscape: "1536*1024", square: "1024*1024" }[input.aspectRatio] } : {}) } }) });
    } catch { throw new ImageClientError("IMAGE_RESULT_UNKNOWN"); }
    if (!response.ok) throw new ImageClientError(response.status >= 500 ? "IMAGE_RESULT_UNKNOWN" : "IMAGE_GENERATION_REJECTED");
    let body: any;
    try { const text = await boundedResponse(response, 1024 * 1024); body = JSON.parse(text.toString("utf8")); }
    catch { throw new ImageClientError("IMAGE_RESULT_UNKNOWN"); }
    const images = body?.output?.choices?.flatMap((c: any) => c?.message?.content?.filter((c: any) => c?.type === "image" || c?.image).map((c: any) => c.image) ?? []) ?? [];
    if (body.code || images.length !== 1 || typeof images[0] !== "string") throw new ImageClientError("IMAGE_GENERATION_INVALID_RESPONSE");
    this.outputUrl(images[0]);
    return { recovery: this.encrypt(images[0]) };
  }
  async download(recovery: string, signal?: AbortSignal) {
    const url = this.outputUrl(this.decrypt(recovery));
    try {
      const response = await this.request(url, { redirect: "error", signal: AbortSignal.any([AbortSignal.timeout(60_000), ...(signal ? [signal] : [])]) });
      if (!response.ok) throw new Error("download");
      const buffer = await boundedResponse(response, maxBytes);
      const image = sharp(buffer, { limitInputPixels: 40_000_000, failOn: "warning" });
      const metadata = await image.metadata();
      if (!["png", "jpeg", "webp"].includes(metadata.format ?? "") || !metadata.width || !metadata.height || metadata.width > 8192 || metadata.height > 8192 || (metadata.pages ?? 1) > 1) throw new Error("invalid image");
      const data = await image.png().toBuffer(); // Full decoding verifies the entire image, then canonical PNG storage.
      if (data.length > maxBytes) throw new Error("too large");
      return { data, mimeType: "image/png" as const, width: metadata.width, height: metadata.height };
    } catch { throw new ImageClientError("IMAGE_SAVE_RETRYABLE"); }
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
