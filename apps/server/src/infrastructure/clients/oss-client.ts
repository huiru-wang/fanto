import OSS from "ali-oss";

export class OssStorage {
  private client: any;
  constructor(options: { region: string; endpoint?: string; bucket: string; accessKeyId: string; accessKeySecret: string }) { this.client = new OSS(options); }
  putUrl(key: string, contentType: string) { return this.client.signatureUrl(key, { method: "PUT", expires: 900, "Content-Type": contentType }); }
  readUrl(key: string) { return this.client.signatureUrl(key, { method: "GET", expires: 300 }); }
  async head(key: string) { return this.client.head(key); }
  async remove(key: string) { await this.client.delete(key); }
}
