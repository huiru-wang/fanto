import { existsSync } from "node:fs";
import { relative, resolve } from "node:path";
import type { Record, Result, Thread } from "./schemas.js";

export function validateThread(thread: Thread, newRecordIds: Set<string>, recordIds: Set<string>) {
  if (thread.evidence.some(id => !recordIds.has(id))) return "thread references an unknown record";
  if (!thread.evidence.some(id => newRecordIds.has(id))) return "thread must use a record from this batch";
  return null;
}

export function validateResult(result: Result, records: Record[], runDir: string) {
  const ids = new Set(records.map(record => record.id));
  if (result.sourceRecordIds.some(id => !ids.has(id))) return "result references an unknown record";
  if (result.kind === "possibility" && new Set(result.sourceRecordIds.map(id => records.find(record => record.id === id)?.batch)).size < 3) return "possibility needs evidence from three batches";
  if (result.kind === "possibility" && !result.artifactPaths.length) return "possibility needs a real artifact";
  for (const path of result.artifactPaths) {
    if (relative(runDir, resolve(path)).startsWith("..")) return "artifact is outside this run";
    if (!existsSync(path)) return "artifact does not exist";
  }
  return null;
}
