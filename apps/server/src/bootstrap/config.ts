/**
 * .env 加载与应用配置。
 */

import { readFileSync } from "node:fs";

export interface AppConfig {
  databaseUrl: string;
  agentApiToken: string;
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
  const agentApiToken = required("AGENT_API_TOKEN");
  const embeddingDimension = parseInt(process.env.DASHSCOPE_EMBEDDING_DIMENSION ?? "768", 10);
  if (embeddingDimension !== 768) throw new Error("DASHSCOPE_EMBEDDING_DIMENSION must be 768");
  const endpoint = process.env.OSS_ENDPOINT?.trim();
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

  return {
    databaseUrl,
    agentApiToken,
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
  };
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
