import { logExternalCall } from "../logging/external-call.js";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import sharp from "sharp";
import { logSummary } from "../logging/logger.js";

export interface ImageUnderstanding {
  describe(input: { imageUrl: string; signal?: AbortSignal }): Promise<{ description: string }>;
  review?(input: { imageUrl: string; referenceUrls?: string[]; brief: string; signal?: AbortSignal }): Promise<{ review: string }>;
}

const prompt = `你正在为个人记录中的一张图片生成简洁、客观的中文描述，供用户稍后回顾。

请用 1 到 3 句完整中文描述可见的主体、环境、动作或事件，以及清晰可读的文字（若有）。
只陈述画面直接可见的事实；不要猜测人物身份、姓名、关系、职业、地点、时间、动机、情绪或故事背景。不要评价美丑、质量、构图或摄影风格。不要使用标题、列表、Markdown、免责声明或“这张图片展示了”等套话。`;

export class QwenImageUnderstanding implements ImageUnderstanding {
  constructor(private apiKey: string, private baseUrl: string, private model = "qwen3-vl-flash") {}
  async review(input: { imageUrl: string; referenceUrls?: string[]; brief: string; signal?: AbortSignal }) {
    const instruction = `请以专业视觉编辑身份检查实际生成图片（第一张），若有后续图片则是用户提供的真实参考图，需要对比主体身份、人物数量和细节的一致性；无参考图时不可声称对比过原图。检查当前图片是否满足以下创作命题：${input.brief.slice(0, 2000)}。只根据这张图片能直接观察到的内容判断：主体、构图、光影、文字、身体结构是否有明显问题，以及不能仅凭此图核实的身份或历史事实。请用简洁中文给出：可见内容、明显缺陷、需要复核的部分、针对缺陷的修改建议。不预设图像优秀，不虚构参考图比较结果。`;
    const review = await this.analyze([input.imageUrl, ...(input.referenceUrls ?? [])], instruction, "review", input.signal);
    return { review: review.slice(0, 2400) };
  }
  async describe(input: { imageUrl: string; signal?: AbortSignal }) {
    const description = await this.analyze([input.imageUrl], prompt, "describe", input.signal);
    return { description: description.slice(0, 1_000) };
  }
  private async analyze(imageUrls: string[], instruction: string, operation: string, signal?: AbortSignal): Promise<string> {
    const details: Record<string, unknown> = { model: this.model, imageCount: imageUrls.length };
    return logExternalCall("image", operation, details, async () => {
      const response = await fetch(`${this.baseUrl}/chat/completions`, { method: "POST", signal, headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: this.model, messages: [{ role: "user", content: [...imageUrls.map(url => ({ type: "image_url", image_url: { url } })), { type: "text", text: instruction }] }] }) });
      details.httpStatus = response.status;
      if (!response.ok) throw new Error(`image model failed: ${response.status}`);
      const body = await response.json() as { choices?: Array<{ finish_reason?: string; message?: { content?: unknown } }> };
      const choice = body.choices?.[0]; const description = typeof choice?.message?.content === "string" ? choice.message.content.trim() : "";
      if (choice?.finish_reason !== "stop" || !description) throw new Error("image model returned no complete description");
      return description;
    });
  }
}

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
    const details: Record<string, unknown> = { model: this.options.model, referenceCount: input.referenceUrls.length, aspectRatio: input.aspectRatio };
    return logExternalCall("image", "generate", details, async () => {
      if (input.referenceUrls.length < 1 || input.referenceUrls.length > 3) throw new ImageClientError("INVALID_REFERENCE_IMAGES");
      const startedAt = Date.now();
      const requestSignal = AbortSignal.any([AbortSignal.timeout(this.options.timeoutMs), ...(signal ? [signal] : [])]);
      let response: Response | undefined;
      let body: any;
      let stage = "request";
      try {
        response = await this.request(this.options.endpoint, { method: "POST", redirect: "error", signal: requestSignal, headers: { Authorization: `Bearer ${this.options.apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: this.options.model, input: { messages: [{ role: "user", content: [...input.referenceUrls.map(image => ({ image })), { text: input.prompt }] }] }, parameters: { n: 1, prompt_extend: true, prompt_extend_mode: "direct", watermark: false, ...(input.aspectRatio ? { size: { portrait: "1024*1536", landscape: "1536*1024", square: "1024*1024" }[input.aspectRatio] } : {}) } }) });
        details.httpStatus = response.status;
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
    });
  }
  async download(recovery: string, signal?: AbortSignal) {
    const details: Record<string, unknown> = {};
    return logExternalCall("image", "download", details, async () => {
      const startedAt = Date.now();
      const requestSignal = AbortSignal.any([AbortSignal.timeout(60_000), ...(signal ? [signal] : [])]);
      let stage = "recovery";
      let response: Response | undefined;
      try {
        const url = this.outputUrl(this.decrypt(recovery));
        stage = "download_request";
        response = await this.request(url, { redirect: "error", signal: requestSignal });
        details.httpStatus = response.status;
        if (!response.ok) throw new Error("Image download HTTP error");
        stage = "download_body";
        const buffer = await boundedResponse(response, maxBytes);
        details.downloadBytes = buffer.length;
        stage = "decode_image";
        const image = sharp(buffer, { limitInputPixels: 40_000_000, failOn: "warning" });
        const metadata = await image.metadata();
        if (!["png", "jpeg", "webp"].includes(metadata.format ?? "") || !metadata.width || !metadata.height || metadata.width > 8192 || metadata.height > 8192 || (metadata.pages ?? 1) > 1) throw new Error("Invalid image dimensions or format");
        const data = await image.png().toBuffer();
        if (data.length > maxBytes) throw new Error("Image too large");
        Object.assign(details, { bytes: data.length, mimeType: "image/png", width: metadata.width, height: metadata.height });
        return { data, mimeType: "image/png" as const, width: metadata.width, height: metadata.height };
      } catch (error) {
        const code = error instanceof ImageClientError && stage === "recovery" ? error.code : "IMAGE_SAVE_RETRYABLE";
        const reason = signal?.aborted ? "caller_aborted" : requestSignal.aborted ? "request_timeout" : response && !response.ok ? "http_error" : stage;
        throw failure(code, stage, startedAt, reason, error, response);
      }
    });
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
