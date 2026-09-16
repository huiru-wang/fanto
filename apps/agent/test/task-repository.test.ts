import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { AgentTaskRepository } from "../src/tasks/task-repository.js";

test("persists task state and recovers interrupted tasks", () => {
  const root = mkdtempSync(resolve(tmpdir(), "fanto-task-"));
  const repository = new AgentTaskRepository(resolve(root, "agent.sqlite"));
  try {
    const task = repository.create({ sessionId: "8c52e2fc-1741-42b3-8973-cfae75ff3f63", agentId: "coding", message: "hello", traceId: "trace_1" });
    assert.equal(task.status, "pending");
    const claimed = repository.claimNext();
    assert.equal(claimed?.id, task.id);
    assert.equal(claimed?.status, "running");
    repository.complete(task.id, "done");
    assert.equal(repository.get(task.id)?.status, "completed");
    const interrupted = repository.create({ sessionId: task.sessionId, agentId: "coding", message: "again" });
    repository.claimNext();
    repository.recoverInterrupted();
    assert.equal(repository.get(interrupted.id)?.status, "failed");
  } finally {
    repository.close();
    rmSync(root, { recursive: true, force: true });
  }
});
