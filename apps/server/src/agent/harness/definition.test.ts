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
