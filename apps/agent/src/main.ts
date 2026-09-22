import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { AgentRegistry } from "./agent/registry.js";
import { AgentSessionManager } from "./agent/session.js";
import { createApp } from "./app.js";
import { ContextBuilder } from "./context/builder.js";
import { CharacterProvider } from "./context/providers/character.js";
import { MemoryProvider, PiQueryRewriter } from "./context/providers/memory.js";
import { PreferenceProvider } from "./context/providers/preference.js";
import { CurrentTimeProvider } from "./context/providers/time.js";
import { ContextRuntime } from "./context/runtime.js";
import { FantoServerClient } from "./fanto/client.js";
import { SkillLoader } from "./skills/loader.js";
import { AgentTaskRepository } from "./tasks/repository.js";
import { TaskRunner } from "./tasks/runner.js";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const projectRoot = resolve(appRoot, "../..");
const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");

const fromProjectRoot = (value: string | undefined, fallback: string) =>
  value
    ? (isAbsolute(value) ? value : resolve(projectRoot, value))
    : resolve(projectRoot, fallback);

const models = builtinModels();
const skills = new SkillLoader(resolve(appRoot, "skills"));
const fantoServer = new FantoServerClient(process.env.FANTO_SERVER_BASE_URL ?? "http://127.0.0.1:3000");
const contextRuntime = new ContextRuntime(new ContextBuilder([
  new CharacterProvider(),
  new CurrentTimeProvider(),
  new PreferenceProvider(fantoServer),
  new MemoryProvider(fantoServer, new PiQueryRewriter(models)),
]));
const registry = new AgentRegistry(resolve(appRoot, "agents.yaml"), models, skills);
const sessions = new AgentSessionManager(
  models,
  fantoServer,
  skills,
  fromProjectRoot(process.env.AGENT_SESSION_DB, "data/agent-sessions.sqlite"),
  fromProjectRoot(process.env.AGENT_WORKSPACE_ROOT, "data/workspaces"),
);
const tasks = new AgentTaskRepository(
  fromProjectRoot(process.env.AGENT_SESSION_DB, "data/agent-sessions.sqlite"),
);
const runner = new TaskRunner(tasks, sessions, registry, contextRuntime);
runner.start();

const app = createApp(
  process.env.AGENT_TOKEN ?? "",
  registry,
  sessions,
  tasks,
  runner,
  new Set(["user001"]),
  contextRuntime,
);
const server = serve({ fetch: app.fetch, hostname: "0.0.0.0", port }, info => {
  console.log(`Agent service listening on port ${info.port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close(() => {
      runner.stop();
      tasks.close();
      void sessions.close().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
