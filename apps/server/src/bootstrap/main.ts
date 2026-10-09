import { CreativeService } from "../domain/projects/creative-service.js";
import { CreativeImageClient } from "../infrastructure/clients/creative-image-client.js";
import { serve } from "@hono/node-server";
import { loadConfig, loadEnv } from "./config.js";
import { checkDatabaseHealth, createDatabase, runMigrations } from "../infrastructure/database/database.js";
import { QwenImageUnderstanding } from "../infrastructure/clients/image-client.js";
import { QwenAudioTranscription } from "../infrastructure/clients/audio-client.js";
import { EmbeddingsClient } from "../infrastructure/clients/embeddings-client.js";
import { RecordPostprocessQueue } from "../event/record-postprocess-queue.js";
import { RecordEmbeddingQueue } from "../event/record-embedding-queue.js";
import { AgentExecutionQueue } from "../event/agent-execution-queue.js";
import { SessionEventBus } from "../event/session-event-bus.js";
import { registerRecordEmbeddingListener } from "../listeners/record-embedding.listener.js";
import { AgentWorker } from "../execution/agent-worker.js";
import { AgentExecutionListener } from "../execution/agent-execution.listener.js";
import { ProposalHandler } from "../execution/handlers/proposal.handler.js";
import { CreatorHandler } from "../execution/handlers/creator.handler.js";
import { TaskHandler } from "../execution/handlers/task.handler.js";
import { OssStorage } from "../infrastructure/clients/oss-client.js";
import { registerRecordPostprocessListener } from "../listeners/record-postprocess.listener.js";
import { createApp, type ServerServices } from "./app.js";
import { logError, logInfo } from "../infrastructure/logging/logger.js";
import { JwtTokenService } from "../infrastructure/auth/jwt-token-service.js";
import { GoogleIdentityProvider } from "../infrastructure/auth/providers/google-identity-provider.js";
import { AppleIdentityProvider } from "../infrastructure/auth/providers/apple-identity-provider.js";
import { IdentityProviderRegistry } from "../domain/auth/identity-provider.js";
import { AuthService } from "../domain/auth/index.js";
import { RecordRetrievalService, RecordService, type Record } from "../domain/records/index.js";
import { MediaService } from "../domain/media/index.js";
import { ProjectService, ProposalService } from "../domain/projects/index.js";
import { TaskService } from "../domain/tasks/index.js";
import { MemoryService } from "../domain/memory/index.js";
import { createAgentRuntime } from "../agent/agent-runtime.js";
import { TaskScheduler } from "../domain/tasks/scheduler.js";
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
const retrieval = RecordRetrievalService.create(db, embeddings);
const memories = MemoryService.create(db, embeddings);
const queue = new RecordPostprocessQueue();
const records = RecordService.create(db, queue, retrieval, recordListCache, undefined, media);
const tasks = new TaskService(db, {
  minSeconds: config.tasks.timeoutMinSeconds,
  maxSeconds: config.tasks.timeoutMaxSeconds,
});
const projects = ProjectService.create(db, records, media, embeddings);
const proposals = ProposalService.create(db, records, media, embeddings);
const creative = config.creative.enabled ? new CreativeService(db, records, projects, proposals, media, new CreativeImageClient(config.creative.image), userId => auth.assertActiveUser(userId)) : undefined;
const agent = createAgentRuntime({ records, media, tasks, memories, creative, ...config.agent });
const embeddingQueue=new RecordEmbeddingQueue();
const agentQueue=new AgentExecutionQueue();
const events=new SessionEventBus();
const worker=new AgentWorker(agent.sessions,events);
const proposalHandler=creative?new ProposalHandler(records,agent,worker,config.creative.proposalTimeoutMs):undefined;
const creatorHandler=creative?new CreatorHandler(projects,proposals,agent,worker,config.creative.creatorTimeoutMs):undefined;
const taskHandler=new TaskHandler(tasks,agent,worker);
const agentExecution=new AgentExecutionListener(agentQueue,config.agentExecutionConcurrency,proposalHandler,creatorHandler,taskHandler);
const taskScheduler=new TaskScheduler(tasks,agentQueue,config.tasks.schedulerIntervalMs);
tasks.setSchedulerWake(()=>taskScheduler.wake());

registerRecordPostprocessListener(
  queue,records,media,oss,
  new QwenImageUnderstanding(config.dashscope.apiKey,config.dashscope.baseUrl,config.dashscope.visionModel),
  new QwenAudioTranscription(config.dashscope.apiKey,config.dashscope.baseUrl,config.dashscope.asrModel),
  embeddingQueue,agentQueue
);
registerRecordEmbeddingListener(embeddingQueue,records,retrieval);
taskScheduler.start();

if (creative) await projects.normalizeLegacyMedia();

const services: ServerServices = {
  auth,
  records,
  media,
  projects,
  agentQueue,
  events,
  agentWorker: worker,
  proposals,
  creative,
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
  await agentExecution.stop();
  await agent.close();
  await db.destroy();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
