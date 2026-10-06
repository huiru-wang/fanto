import { serve } from "@hono/node-server";
import { loadConfig, loadEnv } from "./config.js";
import { checkDatabaseHealth, createDatabase, runMigrations } from "../infrastructure/database/database.js";
import { QwenImageUnderstanding } from "../infrastructure/clients/image-client.js";
import { QwenAudioTranscription } from "../infrastructure/clients/audio-client.js";
import { EmbeddingsClient } from "../infrastructure/clients/embeddings-client.js";
import { RecordPostprocessQueue } from "../infrastructure/queue/record-postprocess-queue.js";
import { OssStorage } from "../infrastructure/clients/oss-client.js";
 import { registerRecordPostprocessListener } from "../listeners/record-postprocess.listener.js";
import { createApp, type ServerServices } from "./app.js";
import { logError, logInfo } from "../infrastructure/logging/logger.js";
import { JwtTokenService } from "../infrastructure/auth/jwt-token-service.js";
import { GoogleIdentityProvider } from "../infrastructure/auth/providers/google-identity-provider.js";
import { AppleIdentityProvider } from "../infrastructure/auth/providers/apple-identity-provider.js";
import { IdentityProviderRegistry } from "../domain/auth/identity-provider.js";
import { AuthService } from "../domain/auth/index.js";
import { PostgresRecordIndex, RecordRetrievalService, RecordService, type Record } from "../domain/records/index.js";
import { MediaService } from "../domain/media/index.js";
import { ProjectService } from "../domain/projects/index.js";
import { TaskService } from "../domain/tasks/index.js";
import { createAgentRuntime } from "../agent/agent-runtime.js";
import { TaskScheduler, TaskWorker, TaskWorkerPool } from "../task-runtime/index.js";
import { TtlCache } from "../infrastructure/cache/ttl-cache.js";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const HEALTH_CHECK_INTERVAL_MS = 10_000;
const HEALTH_CHECK_TIMEOUT_MS = 5_000;
const HEALTH_CHECK_FAILURE_THRESHOLD = 3;

loadEnv();
const config = loadConfig();
const db = createDatabase(config.databaseUrl);
await runMigrations(db);
await checkDatabaseHealth(db, HEALTH_CHECK_TIMEOUT_MS);
const healthCheck = () => checkDatabaseHealth(db, HEALTH_CHECK_TIMEOUT_MS);

const authTokens = await JwtTokenService.create(config.auth);
const identityProviders = new IdentityProviderRegistry([
  new GoogleIdentityProvider(config.auth.googleAllowedClientIds),
  new AppleIdentityProvider(config.auth.appleAllowedClientIds),
]);
const userStatusCache = new TtlCache<string, { user_id: string; status: "active" | "disabled" } | null>({
  ttlMs: CACHE_TTL_MS,
  maxEntries: 20_000,
});
const auth = new AuthService(db, identityProviders, authTokens, userStatusCache);
const recordListCache = new TtlCache<string, { records: Record[]; hasMoreAfterTopTen: boolean }>({
  ttlMs: CACHE_TTL_MS,
  maxEntries: 2_000,
});
const oss = new OssStorage(config.oss);
const media = MediaService.create(db, oss);
const embeddings = new EmbeddingsClient(
  config.dashscope.apiKey,
  config.dashscope.baseUrl,
  config.dashscope.embeddingModel,
  config.dashscope.embeddingDimension,
);
const recordIndex = new PostgresRecordIndex(db);
const retrieval = new RecordRetrievalService(recordIndex, embeddings);
const queue = new RecordPostprocessQueue();
const records = RecordService.create(db, queue, retrieval, recordListCache);
const tasks = new TaskService(db, {
  minSeconds: config.tasks.timeoutMinSeconds,
  maxSeconds: config.tasks.timeoutMaxSeconds,
});
const agent = createAgentRuntime({ records, media, tasks, ...config.agent });
const taskWorker = new TaskWorker(tasks, agent.registry, agent.sessions);
const taskWorkerPool = new TaskWorkerPool(config.tasks.workerConcurrency, taskWorker);
const taskScheduler = new TaskScheduler(tasks, taskWorkerPool, config.tasks.schedulerIntervalMs);
await tasks.recoverRunning();
taskScheduler.start();

registerRecordPostprocessListener(
  queue,
  records,
  media,
  oss,
  new QwenImageUnderstanding(config.dashscope.apiKey, config.dashscope.baseUrl, config.dashscope.visionModel),
  new QwenAudioTranscription(config.dashscope.apiKey, config.dashscope.baseUrl, config.dashscope.asrModel),
  retrieval,
);

const services: ServerServices = {
  auth,
  records,
  media,
  projects: ProjectService.create(db, records),
  tasks,
  agent,
  healthCheck,
};

const server = serve({
  fetch: createApp(services).fetch,
  port: config.port,
  hostname: config.host,
});
logInfo("main", "Server listening", { host: config.host, port: config.port });

let shuttingDown = false;
let healthCheckRunning = false;
let consecutiveHealthFailures = 0;
const healthMonitor = setInterval(() => {
  if (shuttingDown || healthCheckRunning) return;
  healthCheckRunning = true;
  void healthCheck()
    .then(() => {
      if (consecutiveHealthFailures > 0) {
        logInfo("health", "Database health recovered", { previousFailures: consecutiveHealthFailures });
      }
      consecutiveHealthFailures = 0;
    })
    .catch(cause => {
      consecutiveHealthFailures += 1;
      const error = cause instanceof Error ? cause : new Error(String(cause));
      logError("health", "Database health check failed", {
        error: error.message,
        consecutiveFailures: consecutiveHealthFailures,
        failureThreshold: HEALTH_CHECK_FAILURE_THRESHOLD,
      });
      if (consecutiveHealthFailures >= HEALTH_CHECK_FAILURE_THRESHOLD) {
        logError("health", "Service is persistently unavailable; exiting for PM2 restart", {
          consecutiveFailures: consecutiveHealthFailures,
        });
        process.exit(1);
      }
    })
    .finally(() => {
      healthCheckRunning = false;
    });
}, HEALTH_CHECK_INTERVAL_MS);
healthMonitor.unref();

const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(healthMonitor);
  logInfo("main", "Shutting down", { signal });

  taskScheduler.stop();
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
  await agent.close();
  await db.destroy();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
