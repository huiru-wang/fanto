/**
 * .env 加载与应用配置。
 */

import { readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadObjectStorageConfig, type ObjectStorageConfig } from "./object-storage-config.js";

export type AppConfig = {
  databaseUrl: string;
  adminAccessKey: string | undefined;
  port: number;
  host: string;
  auth: {
    webOrigin: string;
    idleTtlSeconds: number;
    maxTtlSeconds: number;
    googleAllowedClientIds: string[];
    appleAllowedClientIds: string[];
  };
  dashscope: { apiKey: string; baseUrl: string; embeddingModel: string; embeddingDimension: number; visionModel: string; asrModel: string };
  agent: { workspaceRoot: string; definitionPath: string; deepseekApiKey: string };
} & ObjectStorageConfig;

export function loadEnv(path = ".env") {
  try {
    for (const line of readFileSync(path, "utf-8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      // Explicit environment variables (deployment, isolated test DB) take precedence.
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    /* .env 不存在则跳过 */
  }
}

export function loadConfig(): AppConfig {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const embeddingDimension = parseInt(process.env.DASHSCOPE_EMBEDDING_DIMENSION ?? "768", 10);
  if (embeddingDimension !== 768) throw new Error("DASHSCOPE_EMBEDDING_DIMENSION must be 768");
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
  const projectPath = (value: string | undefined, fallback: string) => value
    ? (isAbsolute(value) ? value : resolve(projectRoot, value))
    : resolve(projectRoot, fallback);
  const storage = loadObjectStorageConfig();

  const googleAllowedClientIds = required("GOOGLE_ALLOWED_CLIENT_IDS").split(",").map(value => value.trim()).filter(Boolean);
  if (googleAllowedClientIds.length === 0) throw new Error("GOOGLE_ALLOWED_CLIENT_IDS is required");
  const appleAllowedClientIds = required("APPLE_ALLOWED_CLIENT_IDS").split(",").map(value => value.trim()).filter(Boolean);
  if (appleAllowedClientIds.length === 0) throw new Error("APPLE_ALLOWED_CLIENT_IDS is required");

  return {
    databaseUrl,
    adminAccessKey: process.env.ADMIN_ACCESS_KEY?.trim() || undefined,
    port: parseInt(process.env.PORT ?? "3000", 10),
    host: process.env.HOST ?? "0.0.0.0",
    auth: {
      webOrigin: required("AUTH_WEB_ORIGIN"),
      idleTtlSeconds: Number(process.env.AUTH_SESSION_IDLE_TTL_SECONDS ?? 604800),
      maxTtlSeconds: Number(process.env.AUTH_SESSION_MAX_TTL_SECONDS ?? 2592000),
      googleAllowedClientIds,
      appleAllowedClientIds,
    },
    ...storage,
    dashscope: {
      apiKey: process.env.DASHSCOPE_API_KEY ?? "",
      baseUrl: process.env.DASHSCOPE_BASE_URL ?? "https://ws-2gkw6cbbhgg7bqz5.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
      embeddingModel: process.env.DASHSCOPE_EMBEDDING_MODEL ?? "qwen3.7-text-embedding-flash",
      embeddingDimension,
      visionModel: process.env.DASHSCOPE_VL_MODEL ?? "qwen3-vl-flash",
      asrModel: process.env.DASHSCOPE_ASR_MODEL ?? "qwen3-asr-flash",
    },
    agent: {
      workspaceRoot: projectPath(process.env.AGENT_WORKSPACE_ROOT, "data/workspaces"),
      definitionPath: projectPath(process.env.AGENT_CONFIG_PATH, "apps/server/agent.yaml"),
      deepseekApiKey: required("DEEPSEEK_API_KEY"),
    },
  };
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(name + " is required");
  return value;
}
