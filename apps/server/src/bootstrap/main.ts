import { serve } from "@hono/node-server";
import { loadConfig, loadEnv } from "./config.js";
import { createDatabase, runMigrations } from "../infrastructure/database/database.js";
import { QwenImageUnderstanding } from "../infrastructure/clients/image-client.js";
import { QwenAudioTranscription } from "../infrastructure/clients/audio-client.js";
import { EmbeddingsClient } from "../infrastructure/clients/embeddings-client.js";
import { RecordPostprocessQueue } from "../infrastructure/queue/record-postprocess-queue.js";
import { OssStorage } from "../infrastructure/clients/oss-client.js";
 import { registerRecordPostprocessListener } from "../listeners/record-postprocess.listener.js";
import { createApp, type ServerServices } from "./app.js";
import { logInfo } from "../infrastructure/logging/logger.js";
import { MemoryService } from "../domain/memory/index.js";
import { PostgresMemoryIndex } from "../infrastructure/memory/postgres-memory-index.js";
import { PreferenceService } from "../domain/preferences/index.js";
import { JwtTokenService } from "../infrastructure/auth/jwt-token-service.js";
import { GoogleIdentityProvider } from "../infrastructure/auth/providers/google-identity-provider.js";
import { AppleIdentityProvider } from "../infrastructure/auth/providers/apple-identity-provider.js";
import { IdentityProviderRegistry } from "../domain/auth/identity-provider.js";
import { AuthService } from "../domain/auth/index.js";
import { RecordService } from "../domain/records/index.js";
import { MediaService } from "../domain/media/index.js";
import { CreationService, CreationProposalService } from "../domain/creations/index.js";
import { createAgentRuntime } from "../agent/agent-runtime.js";

loadEnv();
const config = loadConfig();
const db = createDatabase(config.databaseUrl);
await runMigrations(db);

const authTokens = await JwtTokenService.create(config.auth);
const identityProviders = new IdentityProviderRegistry([
  new GoogleIdentityProvider(config.auth.googleAllowedClientIds),
  new AppleIdentityProvider(config.auth.appleAllowedClientIds),
]);
const auth = new AuthService(db, identityProviders, authTokens);
const oss = new OssStorage(config.oss);
const media = MediaService.create(db, oss);
const preferences = PreferenceService.create(db);
const embeddings = new EmbeddingsClient(
  config.dashscope.apiKey,
  config.dashscope.baseUrl,
  config.dashscope.embeddingModel,
  config.dashscope.embeddingDimension,
);
const memoryIndex = new PostgresMemoryIndex(db);
const memory = new MemoryService(memoryIndex, embeddings);
const queue = new RecordPostprocessQueue();
const records = RecordService.create(db, media, queue, memory);
const agent = createAgentRuntime({ records, media, preferences, ...config.agent });

registerRecordPostprocessListener(
  queue,
  records,
  media,
  oss,
  new QwenImageUnderstanding(config.dashscope.apiKey, config.dashscope.baseUrl, config.dashscope.visionModel),
  new QwenAudioTranscription(config.dashscope.apiKey, config.dashscope.baseUrl, config.dashscope.asrModel),
  memory,
);

const services: ServerServices = {
  auth,
  records,
  media,
  preferences,
  creations: CreationService.create(db),
  creationProposals: CreationProposalService.create(db),
  agent,
};

const server = serve({
  fetch: createApp(services).fetch,
  port: config.port,
  hostname: config.host,
});
logInfo("main", "Server listening", { host: config.host, port: config.port });

const shutdown = async () => {
  server.close();
  await agent.close();
  await db.destroy();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
