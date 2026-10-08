import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { AgentRegistry } from "./registry.js";
import { SkillLoader } from "../skills/loader.js";

test("agent.yaml exposes task management and the single task-worker", () => {
  const root = process.cwd();
  const registry = new AgentRegistry(
    resolve(root, "agent.yaml"),
    builtinModels(),
    new SkillLoader(resolve(root, "skills")),
  );

  const main = registry.get("main");
  const worker = registry.get("task-worker");

  assert.ok(main?.tools.includes("collect_user_input"));
  assert.ok(main?.tools.includes("create_task"));
  assert.ok(main?.tools.includes("update_task"));
  assert.ok(main?.tools.includes("get_task"));
  assert.equal(main?.task?.enabled, undefined);
  assert.deepEqual(worker?.task, {
    enabled: true,
    defaultTimeoutSeconds: 900,
    maxTimeoutSeconds: 3600,
    maxAttempts: 3,
  });
  assert.ok(worker?.tools.includes("web_search"));
  assert.ok(worker?.tools.includes("task_plan_manage"));
  assert.ok(worker?.tools.includes("deliver_task_result"));
  assert.match(worker?.systemPrompt ?? "", /Fanto 的后台执行 Agent/);
  assert.match(worker?.systemPrompt ?? "", /task_plan_manage/);
  const taskAgents = registry.taskAgents();
  assert.equal(taskAgents.length, 1);
  assert.equal(taskAgents[0]?.id, "task-worker");
  assert.match(taskAgents[0]?.description ?? "", /最终仅可交付 text、markdown 或 html 文件/);
  assert.match(taskAgents[0]?.description ?? "", /不要创建后台任务/);
});


test("creative agents are internal, use object-root schemas and cannot use Task or filesystem tools", async () => {
  const registry = new AgentRegistry(resolve("agent.yaml"), builtinModels(), new SkillLoader(resolve("skills")));
  assert.deepEqual(registry.get("proposal-agent")?.tools, ["record_read", "project_read", "proposal_create", "skill_read"]);
  assert.deepEqual(registry.get("creator-agent")?.tools, ["record_read", "project_read", "image_generate", "project_manage", "skill_read"]);
  assert.deepEqual(registry.get("proposal-agent")?.skills, ["creative"]);
  assert.deepEqual(registry.get("creator-agent")?.skills, ["creative"]);
  assert.equal(registry.taskAgents().some(agent => agent.id === "creator-agent" || agent.id === "proposal-agent"), false);
  const { createTools } = await import("../tools/index.js");
  const skills = new SkillLoader(resolve("skills"));
  for (const tool of createTools(registry.get("creator-agent")!.tools, process.cwd(), {} as never, [], skills, registry.get("creator-agent")!.skills)) assert.equal((tool.parameters as { type?: string }).type, "object");
});
