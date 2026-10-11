import { AliyunStorage } from "../infrastructure/clients/storage/aliyun-storage.js";
import type { ObjectStorage } from "../infrastructure/clients/storage/object-storage.js";
import type { AppConfig } from "./config.js";

export function createObjectStorage(config: AppConfig): ObjectStorage {
  if (config.objectStorageProvider !== "aliyun-oss") throw new Error("Unsupported object storage provider");
  return new AliyunStorage(config.oss);
}
