import OSS from "ali-oss";
import { logExternalCall } from "../logging/external-call.js";

export type MediaVariant = "thumbnail" | "original";

const THUMBNAIL_PROCESS = "image/resize,w_600/quality,q_80/format,webp";

export class OssStorage {
  private client: any;
  constructor(options: { region: string; endpoint?: string; bucket: string; accessKeyId: string; accessKeySecret: string }) { this.client = new OSS(options); }
  putUrl(key: string, contentType: string) { return this.client.signatureUrl(key, { method: "PUT", expires: 900, "Content-Type": contentType }); }
  async putObject(key: string, data: Buffer, contentType: string) {
    const details: Record<string, unknown> = { bytes: data.length, contentType };
    return logExternalCall("oss", "put", details, async () => {
      const result = await this.client.put(key, data, { headers: { "Content-Type": contentType } });
      details.httpStatus = result?.res?.status;
    });
  }
  async getObject(key: string): Promise<Buffer> {
    const details: Record<string, unknown> = {};
    return logExternalCall("oss", "get", details, async () => {
      const result = await this.client.get(key);
      details.httpStatus = result?.res?.status;
      const content = result?.content;
      if (typeof content === "string") details.bytes = Buffer.byteLength(content);
      else if (content instanceof Uint8Array) details.bytes = content.byteLength;
      if (Buffer.isBuffer(content)) return content;
      if (content instanceof Uint8Array) return Buffer.from(content);
      if (typeof content === "string") return Buffer.from(content);
      throw new Error("OSS object content is unavailable");
    });
  }
  readUrl(key: string, variant: MediaVariant = "original", expiresSeconds = 300) {
    return this.client.signatureUrl(key, {
      method: "GET",
      expires: expiresSeconds,
      ...(variant === "thumbnail" ? { process: THUMBNAIL_PROCESS } : {}),
    });
  }
  async head(key: string) {
    const details: Record<string, unknown> = {};
    return logExternalCall("oss", "head", details, async () => {
      const result = await this.client.head(key);
      details.httpStatus = result?.res?.status;
      return result;
    });
  }
  async remove(key: string) {
    const details: Record<string, unknown> = {};
    await logExternalCall("oss", "delete", details, async () => {
      const result = await this.client.delete(key);
      details.httpStatus = result?.res?.status;
    });
  }
}
