import type { AliyunStorageOptions } from "../infrastructure/clients/storage/aliyun-storage.js";
import type { R2StorageOptions } from "../infrastructure/clients/storage/r2-storage.js";

export type ObjectStorageConfig =
  | { objectStorageProvider: "aliyun-oss"; oss: AliyunStorageOptions }
  | { objectStorageProvider: "cloudflare-r2"; r2: R2StorageOptions };

/** Only the selected provider's credentials are required and retained. */
export function loadObjectStorageConfig(env: NodeJS.ProcessEnv = process.env): ObjectStorageConfig {
  const required = (name: string) => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`${name} is required`);
    return value;
  };
  const provider = env.OBJECT_STORAGE_PROVIDER?.trim() || "aliyun-oss";
  if (provider === "aliyun-oss") {
    const endpoint = env.OSS_ENDPOINT?.trim();
    const url = endpoint ? (endpoint.startsWith("http://") || endpoint.startsWith("https://") ? endpoint : `https://${endpoint}`) : undefined;
    if (url?.includes("-internal.")) throw new Error("OSS_ENDPOINT must be publicly reachable");
    return { objectStorageProvider: provider, oss: { region: env.OSS_REGION ?? "oss-rg-china-mainland", endpoint: url,
      bucket: required("OSS_BUCKET"), accessKeyId: required("OSS_ACCESS_KEY_ID"), accessKeySecret: required("OSS_ACCESS_KEY_SECRET") } };
  }
  if (provider === "cloudflare-r2") {
    let endpoint: URL;
    try { endpoint = new URL(required("R2_ENDPOINT")); }
    catch { throw new Error("R2_ENDPOINT must be an HTTPS R2 S3 API endpoint"); }
    if (endpoint.protocol !== "https:" || !/^[a-f0-9]{32}(?:\.(?:eu|us|fedramp))?\.r2\.cloudflarestorage\.com$/.test(endpoint.hostname)
      || endpoint.port || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== "/") {
      throw new Error("R2_ENDPOINT must be an HTTPS R2 S3 API endpoint");
    }
    return { objectStorageProvider: provider, r2: { endpoint: endpoint.origin, bucket: required("R2_BUCKET"),
      accessKeyId: required("R2_ACCESS_KEY_ID"), accessKeySecret: required("R2_ACCESS_KEY_SECRET") } };
  }
  throw new Error("Unsupported OBJECT_STORAGE_PROVIDER");
}
