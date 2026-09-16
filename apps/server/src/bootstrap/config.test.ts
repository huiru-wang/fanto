import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadEnv } from "./config.js";

test("loads .env values ahead of inherited process environment", () => {
  const path = join(tmpdir(), `fanto-env-${randomUUID()}`);
  const before = process.env.DASHSCOPE_API_KEY;
  writeFileSync(path, "DASHSCOPE_API_KEY=from-file\n");
  process.env.DASHSCOPE_API_KEY = "from-process";
  try {
    loadEnv(path);
    assert.equal(process.env.DASHSCOPE_API_KEY, "from-file");
  } finally {
    if (before === undefined) delete process.env.DASHSCOPE_API_KEY;
    else process.env.DASHSCOPE_API_KEY = before;
    rmSync(path, { force: true });
  }
});
