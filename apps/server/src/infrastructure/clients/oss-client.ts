import OSS from "ali-oss";

export type MediaVariant = "thumbnail" | "original";

const THUMBNAIL_PROCESS = "image/resize,w_600/quality,q_80/format,webp";

export class OssStorage {
  private client: any;
  constructor(options: { region: string; endpoint?: string; bucket: string; accessKeyId: string; accessKeySecret: string }) { this.client = new OSS(options); }
  putUrl(key: string, contentType: string) { return this.client.signatureUrl(key, { method: "PUT", expires: 900, "Content-Type": contentType }); }
  async putObject(key: string, data: Buffer, contentType: string) {
    await this.client.put(key, data, { headers: { "Content-Type": contentType } });
  }
  async getObject(key: string): Promise<Buffer> {
    const result = await this.client.get(key);
    const content = result?.content;
    if (Buffer.isBuffer(content)) return content;
    if (content instanceof Uint8Array) return Buffer.from(content);
    if (typeof content === "string") return Buffer.from(content);
    throw new Error("OSS object content is unavailable");
  }
  readUrl(key: string, variant: MediaVariant = "original", expiresSeconds = 300) {
    return this.client.signatureUrl(key, {
      method: "GET",
      expires: expiresSeconds,
      ...(variant === "thumbnail" ? { process: THUMBNAIL_PROCESS } : {}),
    });
  }
  async head(key: string) { return this.client.head(key); }
  async remove(key: string) { await this.client.delete(key); }
}
