import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { AgentRegistry } from "../config/agent-registry.js";
import { HarnessFactory } from "../harness/harness-factory.js";
import { AgentSessionManager } from "../harness/session-manager.js";
import { SkillLoader } from "../skills/loader.js";
import { ToolRegistry } from "../tools/registry.js";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const projectRoot = resolve(appRoot, "../..");
const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");
const fromProjectRoot = (value: string | undefined, fallback: string) => value ? (isAbsolute(value) ? value : resolve(projectRoot, value)) : resolve(projectRoot, fallback);
const skills = new SkillLoader(resolve(appRoot, "skills"));
const factory = new HarnessFactory(new ToolRegistry(), skills);
const registry = new AgentRegistry(resolve(projectRoot, "agents.yaml"), factory.models, skills);
const sessions = new AgentSessionManager(
  factory,
  fromProjectRoot(process.env.AGENT_SESSION_DB, "data/agent-sessions.sqlite"),
  fromProjectRoot(process.env.AGENT_WORKSPACE_ROOT, "data/workspaces"),
);
const app = createApp(process.env.AGENT_TOKEN ?? "", registry, sessions);
const server = serve({ fetch: app.fetch, hostname: "0.0.0.0", port }, info => {
  console.log(`Agent service listening on port ${info.port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close(() => { void sessions.close().finally(() => process.exit(0)); });
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
