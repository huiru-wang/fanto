/**
 * .env 加载与应用配置。
 */

import { readFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

export interface AppConfig {
  sqlitePath: string;
  port: number;
  host: string;
  embeddingApiKey: string | null;
  embeddingApiBase: string;
  embeddingModel: string;
  embeddingDimension: number;
  oss: { region: string; endpoint?: string; bucket: string; accessKeyId: string; accessKeySecret: string };
  dashscope: { apiKey: string; asrBaseUrl: string; vlBaseUrl: string };
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
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    /* .env 不存在则跳过 */
  }
}

export function loadConfig(): AppConfig {
  const sqlitePath = resolve(process.env.SQLITE_PATH ?? "../../data/fanto.sqlite");
  mkdirSync(dirname(sqlitePath), { recursive: true });
  const endpoint = process.env.OSS_ENDPOINT?.trim();
  const ossEndpoint = endpoint ? (endpoint.startsWith("http://") || endpoint.startsWith("https://") ? endpoint : `https://${endpoint}`) : undefined;
  if (ossEndpoint?.includes("-internal.")) throw new Error("OSS_ENDPOINT must be publicly reachable");

  return {
    sqlitePath,
    port: parseInt(process.env.PORT ?? "3000", 10),
    host: process.env.HOST ?? "0.0.0.0",
    embeddingApiKey: process.env.EMBEDDING_API_KEY || process.env.OPENAI_API_KEY || null,
    embeddingApiBase: process.env.EMBEDDING_API_BASE ?? process.env.OPENAI_API_BASE ?? "https://api.openai.com/v1",
    embeddingModel: process.env.EMBEDDING_MODEL ?? "text-embedding-v2",
    embeddingDimension: parseInt(process.env.EMBEDDING_DIMENSION ?? "1536", 10),
    oss: {
      region: process.env.OSS_REGION ?? "oss-cn-hangzhou",
      endpoint: ossEndpoint,
      bucket: process.env.OSS_BUCKET ?? "",
      accessKeyId: process.env.OSS_ACCESS_KEY_ID ?? "",
      accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET ?? "",
    },
    dashscope: {
      apiKey: process.env.DASHSCOPE_API_KEY ?? "",
      asrBaseUrl: process.env.DASHSCOPE_ASR_BASE_URL ?? process.env.DASHSCOPE_BASE_URL ?? "https://ws-2gkw6cbbhgg7bqz5.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
      vlBaseUrl: process.env.DASHSCOPE_VL_BASE_URL ?? process.env.DASHSCOPE_BASE_URL ?? "https://ws-2gkw6cbbhgg7bqz5.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
    },
  };
}
