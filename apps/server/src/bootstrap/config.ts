/**
 * .env 加载与应用配置。
 */

import { readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface AppConfig {
  databaseUrl: string;
  port: number;
  host: string;
  auth: {
    privateKeyPem: string;
    publicKeys: Record<string, string>;
    activeKid: string;
    issuer: string;
    accessAudiences: string[];
    refreshAudience: string;
    accessTtlSeconds: number;
    refreshTtlSeconds: number;
    googleAllowedClientIds: string[];
    appleAllowedClientIds: string[];
  };
  oss: { region: string; endpoint?: string; bucket: string; accessKeyId: string; accessKeySecret: string };
  dashscope: { apiKey: string; baseUrl: string; embeddingModel: string; embeddingDimension: number; visionModel: string; asrModel: string };
  agent: { sessionDatabasePath: string; workspaceRoot: string; definitionPath: string; deepseekApiKey: string };
  creative: { enabled: boolean; intervalMs: number; workers: number; proposalTimeoutMs: number; creatorTimeoutMs: number; image: { endpoint: string; apiKey: string; model: string; timeoutMs: number } };
  tasks: { schedulerIntervalMs: number; workerConcurrency: number; timeoutMinSeconds: number; timeoutMaxSeconds: number };
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
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const embeddingDimension = parseInt(process.env.DASHSCOPE_EMBEDDING_DIMENSION ?? "768", 10);
  if (embeddingDimension !== 768) throw new Error("DASHSCOPE_EMBEDDING_DIMENSION must be 768");
  const endpoint = process.env.OSS_ENDPOINT?.trim();
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
  const projectPath = (value: string | undefined, fallback: string) => value
    ? (isAbsolute(value) ? value : resolve(projectRoot, value))
    : resolve(projectRoot, fallback);
  const ossEndpoint = endpoint ? (endpoint.startsWith("http://") || endpoint.startsWith("https://") ? endpoint : `https://${endpoint}`) : undefined;
  if (ossEndpoint?.includes("-internal.")) throw new Error("OSS_ENDPOINT must be publicly reachable");

  const activeKid = required("AUTH_JWT_ACTIVE_KID");
  const privateKeyPem = normalizePem(required("AUTH_JWT_PRIVATE_KEY"));
  const publicKeys = parsePublicKeys(required("AUTH_JWT_PUBLIC_KEYS"));
  if (!publicKeys[activeKid]) throw new Error("AUTH_JWT_PUBLIC_KEYS must contain AUTH_JWT_ACTIVE_KID");
  const googleAllowedClientIds = required("GOOGLE_ALLOWED_CLIENT_IDS").split(",").map(value => value.trim()).filter(Boolean);
  if (googleAllowedClientIds.length === 0) throw new Error("GOOGLE_ALLOWED_CLIENT_IDS is required");
  const appleAllowedClientIds = required("APPLE_ALLOWED_CLIENT_IDS").split(",").map(value => value.trim()).filter(Boolean);
  if (appleAllowedClientIds.length === 0) throw new Error("APPLE_ALLOWED_CLIENT_IDS is required");

  const taskTimeoutMinSeconds = positiveInt("TASK_TIMEOUT_MIN_SECONDS", 30);
  const taskTimeoutMaxSeconds = positiveInt("TASK_TIMEOUT_MAX_SECONDS", 3600);
  if (taskTimeoutMinSeconds > taskTimeoutMaxSeconds) {
    throw new Error("TASK_TIMEOUT_MIN_SECONDS must not exceed TASK_TIMEOUT_MAX_SECONDS");
  }

  const creativeEnabled = process.env.CREATIVE_ENABLED === "true";
  if (process.env.CREATIVE_ENABLED && !["true", "false"].includes(process.env.CREATIVE_ENABLED)) throw new Error("CREATIVE_ENABLED must be true or false");
  const imageApiKey = process.env.CREATIVE_IMAGE_API_KEY?.trim() || process.env.DASHSCOPE_API_KEY?.trim() || "";
  const imageEndpoint = process.env.CREATIVE_IMAGE_ENDPOINT?.trim() || new URL("/api/v1/services/aigc/multimodal-generation/generation", process.env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com").href;
  if (creativeEnabled && !imageApiKey) throw new Error("CREATIVE_IMAGE_API_KEY or DASHSCOPE_API_KEY is required when creative agents are enabled");
  return {
    databaseUrl,
    port: parseInt(process.env.PORT ?? "3000", 10),
    host: process.env.HOST ?? "0.0.0.0",
    auth: {
      privateKeyPem,
      publicKeys,
      activeKid,
      issuer: process.env.AUTH_JWT_ISSUER?.trim() || "fanto",
      accessAudiences: ["fanto-api", "fanto-agent"],
      refreshAudience: "fanto-refresh",
      accessTtlSeconds: 30 * 60,
      refreshTtlSeconds: 30 * 24 * 60 * 60,
      googleAllowedClientIds,
      appleAllowedClientIds,
    },
    oss: {
      region: process.env.OSS_REGION ?? "oss-rg-china-mainland",
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
    agent: {
      sessionDatabasePath: projectPath(process.env.AGENT_SESSION_DB, "data/agent-sessions.sqlite"),
      workspaceRoot: projectPath(process.env.AGENT_WORKSPACE_ROOT, "data/workspaces"),
      definitionPath: projectPath(process.env.AGENT_CONFIG_PATH, "apps/server/agent.yaml"),
      deepseekApiKey: required("DEEPSEEK_API_KEY"),
    },
    creative: {
      enabled: creativeEnabled,
      intervalMs: positiveInt("CREATIVE_INTERVAL_MS", 2000),
      workers: positiveInt("CREATIVE_WORKERS", 1),
      proposalTimeoutMs: positiveInt("CREATIVE_PROPOSAL_TIMEOUT_MS", 120_000),
      creatorTimeoutMs: positiveInt("CREATIVE_CREATOR_TIMEOUT_MS", 900_000),
      image: { endpoint: imageEndpoint, apiKey: imageApiKey, model: process.env.CREATIVE_IMAGE_MODEL?.trim() || "qwen-image-3.0-pro", timeoutMs: positiveInt("CREATIVE_IMAGE_TIMEOUT_MS", 300_000) },
    },
    tasks: {
      schedulerIntervalMs: positiveInt("TASK_SCHEDULER_INTERVAL_MS", 300_000),
      workerConcurrency: positiveInt("TASK_WORKER_CONCURRENCY", 1),
      timeoutMinSeconds: taskTimeoutMinSeconds,
      timeoutMaxSeconds: taskTimeoutMaxSeconds,
    },
  };
}

function positiveInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  const value = raw ? Number.parseInt(raw, 10) : fallback;
  if (!Number.isInteger(value) || value <= 0) throw new Error(name + " must be a positive integer");
  return value;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(name + " is required");
  return value;
}

function normalizePem(value: string): string {
  return value.replace(/\\n/g, "\n");
}

function parsePublicKeys(value: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("AUTH_JWT_PUBLIC_KEYS must be a JSON object");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("AUTH_JWT_PUBLIC_KEYS must be a JSON object");
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length === 0 || entries.some(([kid, pem]) => !kid || typeof pem !== "string" || !pem.trim())) {
    throw new Error("AUTH_JWT_PUBLIC_KEYS contains invalid key material");
  }
  return Object.fromEntries(entries.map(([kid, pem]) => [kid, normalizePem(String(pem))]));
}
