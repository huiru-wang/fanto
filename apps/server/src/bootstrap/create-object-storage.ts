import { AliyunStorage } from "../infrastructure/clients/storage/aliyun-storage.js";
import { R2Storage } from "../infrastructure/clients/storage/r2-storage.js";
import type { ObjectStorage } from "../infrastructure/clients/storage/object-storage.js";
import type { ObjectStorageConfig } from "./object-storage-config.js";

export function createObjectStorage(config: ObjectStorageConfig): ObjectStorage {
  switch (config.objectStorageProvider) {
    case "aliyun-oss": return new AliyunStorage(config.oss);
    case "cloudflare-r2": return new R2Storage(config.r2);
    default: throw new Error("Unsupported object storage provider");
  }
}
