/**
 * .env 加载与应用配置。
 */

import { readFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

export interface AppConfig {
  sqlitePath: string;
  port: number;
  host: string;
  oss: { region: string; endpoint?: string; bucket: string; accessKeyId: string; accessKeySecret: string };
  dashscope: { apiKey: string; baseUrl: string; embeddingModel: string; embeddingDimension: number; visionModel: string; asrModel: string };
}

export function loadEnv(path = ".env") {
  try {
    for (const line of readFileSync(path, "utf-8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      process.env[key] = val;
    }
  } catch {
    /* .env 不存在则跳过 */
  }
}

export function loadConfig(): AppConfig {
  const sqlitePath = resolve(process.env.SQLITE_PATH ?? "../../data/fanto.sqlite");
  const embeddingDimension = parseInt(process.env.DASHSCOPE_EMBEDDING_DIMENSION ?? "768", 10);
  mkdirSync(dirname(sqlitePath), { recursive: true });
  if (embeddingDimension !== 768) throw new Error("DASHSCOPE_EMBEDDING_DIMENSION must be 768");
  const endpoint = process.env.OSS_ENDPOINT?.trim();
  const ossEndpoint = endpoint ? (endpoint.startsWith("http://") || endpoint.startsWith("https://") ? endpoint : `https://${endpoint}`) : undefined;
  if (ossEndpoint?.includes("-internal.")) throw new Error("OSS_ENDPOINT must be publicly reachable");

  return {
    sqlitePath,
    port: parseInt(process.env.PORT ?? "3000", 10),
    host: process.env.HOST ?? "0.0.0.0",
    oss: {
      region: process.env.OSS_REGION ?? "oss-cn-hangzhou",
      endpoint: ossEndpoint,
      bucket: process.env.OSS_BUCKET ?? "",
      accessKeyId: process.env.OSS_ACCESS_KEY_ID ?? "",
      accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET ?? "",
    },
    dashscope: {
      apiKey: process.env.DASHSCOPE_API_KEY ?? "",
      baseUrl: process.env.DASHSCOPE_BASE_URL ?? "https://ws-2gkw6cbbhgg7bqz5.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
      embeddingModel: process.env.DASHSCOPE_EMBEDDING_MODEL ?? "qwen3.7-text-embedding-flash",
      embeddingDimension,
      visionModel: process.env.DASHSCOPE_VL_MODEL ?? "qwen3-vl-flash",
      asrModel: process.env.DASHSCOPE_ASR_MODEL ?? "qwen3-asr-flash",
    },
  };
}
