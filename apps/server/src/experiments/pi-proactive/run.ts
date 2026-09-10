import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { uuidv7 } from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { createNodeSqliteFactory, SqliteSessionRepository } from "@earendil-works/pi-session-backend-sqlite-node";
import { loadConfig, loadEnv } from "../../env.js";
import { createMainAgent, type ExperimentState } from "./main-agent.js";
import { fixtureSchema } from "./schemas.js";
import { SpecialistRunner } from "./specialist-runner.js";

export async function run(fixturePath: string, root: string, runId = uuidv7()) {
  loadEnv(); const fixture = fixtureSchema.parse(JSON.parse(await readFile(fixturePath, "utf8")));
  await mkdir(root, { recursive: true }); const runDir = resolve(root, runId); await mkdir(runDir, { recursive: false });
  const config = loadConfig(); const models = builtinModels();
  const model = models.getModel(config.provider, config.model) ?? models.getModels().find(item => item.id === config.model);
  if (!model) throw new Error(`Model not found: ${config.provider}/${config.model}`);
  const env = new NodeExecutionEnv({ cwd: runDir });
  const repository = new SqliteSessionRepository({ env, sqlite: createNodeSqliteFactory(), databasePath: resolve(runDir, "sessions.sqlite") });
  const session = await repository.create({ id: uuidv7(), cwd: runDir, metadata: { role: "main" } });
  const state: ExperimentState = { records: [], threads: [], actions: [], batch: 0, delegations: [], memorySearches: 0, batchDelegations: 0 };
  const runner = new SpecialistRunner(repository, models, model, runDir);
  const main = await createMainAgent(session, models, model, { state, runner, runDir });
  await writeFile(resolve(runDir, "manifest.json"), JSON.stringify({ runId, fixturePath, model: model.id, provider: model.provider }, null, 2));

  for (const batch of [...new Set(fixture.records.map(record => record.batch))].sort((a, b) => a - b)) {
    state.batch = batch; state.memorySearches = 0; state.batchDelegations = 0; const batchDir = resolve(runDir, `batch-${String(batch).padStart(2, "0")}`); await mkdir(batchDir);
    const newRecords = fixture.records.filter(record => record.batch === batch);
    state.records.push(...newRecords);
    const before = await main.session.findEntries({ order: "newestFirst", limit: 1 }); const afterSeq = before[0]?.seq ?? 0;
    const outcome = await main.prompt(`Wake-up ${batch}. New records: ${JSON.stringify(newRecords)}. Decide whether to update a Thread, delegate one specialist, or dismiss.`);
    const entries = await main.session.findEntries({ order: "oldestFirst", cursor: { afterSeq }, limit: 500 });
    await writeFile(resolve(batchDir, "input.json"), JSON.stringify({ newRecords }, null, 2));
    await writeFile(resolve(batchDir, "main-entries.json"), JSON.stringify(entries, null, 2));
    await writeFile(resolve(batchDir, "trace.json"), JSON.stringify({ outcome, delegations: state.delegations }, null, 2));
    await writeFile(resolve(batchDir, "threads.json"), JSON.stringify(state.threads, null, 2));
    await writeFile(resolve(batchDir, "result.json"), JSON.stringify(state.actions.at(-1) ?? null, null, 2));
  }
  await main.close(); await repository.close();
  await writeFile(resolve(runDir, "result.json"), JSON.stringify({ threads: state.threads, actions: state.actions, delegations: state.delegations }, null, 2));
  return runDir;
}

async function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const fixture = resolve(process.argv[2] ?? resolve(here, "../../../experiments/pi-proactive/fixtures/user-001.json"));
  const root = resolve(process.argv[3] ?? resolve(here, "../../../experiments/pi-proactive/runs"));
  console.log(`Saved results to ${await run(fixture, root, process.argv[4])}`);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) void main();
