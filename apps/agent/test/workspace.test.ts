import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { assertWorkspacePath, createWorkspace } from "../src/harness/workspace.js";

test("accepts paths inside a session workspace and rejects escapes", () => {
  const root = mkdtempSync(resolve(tmpdir(), "fanto-workspace-"));
  try {
    const workspace = createWorkspace(root, "session");
    mkdirSync(resolve(workspace, "src"));
    assert.doesNotThrow(() => assertWorkspacePath(workspace, "src/index.ts"));
    assert.throws(() => assertWorkspacePath(workspace, "../outside"), /inside/);
    assert.throws(() => assertWorkspacePath(workspace, "/tmp/outside"), /relative/);
    symlinkSync(tmpdir(), resolve(workspace, "outside"));
    assert.throws(() => assertWorkspacePath(workspace, "outside/file"), /symlinks/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
