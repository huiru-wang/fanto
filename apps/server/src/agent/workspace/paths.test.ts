import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createWorkspace } from "./paths.js";

test("workspace is isolated by userId and sessionId", () => {
  const root = mkdtempSync(join(tmpdir(), "fanto-workspace-"));
  try {
    const userId = randomUUID();
    const sessionId = randomUUID();
    assert.equal(createWorkspace(root, userId, sessionId), join(root, userId, sessionId));
    assert.throws(() => createWorkspace(root, "../other-user", sessionId), /Invalid workspace userId/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
