import { serve } from "@hono/node-server";
import { loadConfig, loadEnv } from "./config.js";
import { createDatabase, runMigrations } from "../infrastructure/database/database.js";
import { QwenImageUnderstanding } from "../infrastructure/clients/image-client.js";
import { QwenAudioTranscription } from "../infrastructure/clients/audio-client.js";
import { EmbeddingsClient } from "../infrastructure/clients/embeddings-client.js";
import { RecordPostprocessQueue } from "../infrastructure/queue/record-postprocess-queue.js";
import { OssStorage } from "../infrastructure/clients/oss-client.js";
import { PostgresMediaRepository } from "../domain/media/postgres-repository.js";
import { PostgresRecordRepository } from "../domain/records/postgres-repository.js";
 import { registerRecordPostprocessListener } from "../listeners/record-postprocess.listener.js";
import { createApp } from "./app.js";
import { logInfo } from "../infrastructure/logging/logger.js";
import { MemoryService } from "../domain/memory/memory-service.js";
import { PostgresMemoryIndex } from "../infrastructure/memory/postgres-memory-index.js";
import { CreationReadRepository } from "../domain/creations/creation-repository.js";
import { CreationProposalRepository } from "../domain/creations/proposal-repository.js";
import { PostgresPreferenceRepository } from "../domain/preferences/postgres-repository.js";
import { PreferenceService } from "../domain/preferences/preference-service.js";
import { JwtTokenService } from "../infrastructure/auth/jwt-token-service.js";
import { GoogleIdentityProvider } from "../infrastructure/auth/providers/google-identity-provider.js";
import { AppleIdentityProvider } from "../infrastructure/auth/providers/apple-identity-provider.js";
import { IdentityProviderRegistry } from "../domain/auth/identity-provider.js";
import { AuthService } from "../domain/auth/service.js";

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
const records = new PostgresRecordRepository(db);
const media = new PostgresMediaRepository(db);
const creationRead = new CreationReadRepository(db);
const creationProposals = new CreationProposalRepository(db);
const preferences = new PreferenceService(new PostgresPreferenceRepository(db));
const embeddings = new EmbeddingsClient(
  config.dashscope.apiKey,
  config.dashscope.baseUrl,
  config.dashscope.embeddingModel,
  config.dashscope.embeddingDimension,
);
const memoryIndex = new PostgresMemoryIndex(db);
const memory = new MemoryService(memoryIndex, embeddings);
const queue = new RecordPostprocessQueue();

registerRecordPostprocessListener(
  queue,
  records,
  media,
  oss,
  new QwenImageUnderstanding(config.dashscope.apiKey, config.dashscope.baseUrl, config.dashscope.visionModel),
  new QwenAudioTranscription(config.dashscope.apiKey, config.dashscope.baseUrl, config.dashscope.asrModel),
  memory,
);

const server = serve({
  fetch: createApp(records, media, queue, oss, creationRead, creationProposals, memory, preferences, { tokens: authTokens, service: auth }).fetch,
  port: config.port,
  hostname: config.host,
});
logInfo("main", "Server listening", { host: config.host, port: config.port });

const shutdown = async () => {
  server.close();
  await db.destroy();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
