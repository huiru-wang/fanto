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

  assert.ok(main?.tools.includes("create_task"));
  assert.ok(main?.tools.includes("update_task"));
  assert.ok(main?.tools.includes("get_task"));
  assert.equal(main?.task?.enabled, undefined);
  assert.deepEqual(worker?.task, {
    enabled: true,
    defaultTimeoutSeconds: 900,
    maxTimeoutSeconds: 3600,
  });
  assert.ok(worker?.tools.includes("deliver_task_result"));
  assert.match(worker?.systemPrompt ?? "", /完成任务的唯一方式是调用 deliver_task_result/);
  assert.deepEqual(registry.taskAgents(), [
    {
      id: "task-worker",
      description: "处理所有需要后台独立完成并交付文件的任务，包括资料整理、HTML 页面和卡片、文本与 Markdown 文档、代码及工作区文件修改；需要可预览页面、文件、报告或耗时处理时使用。",
    },
  ]);
});
