import assert from "node:assert/strict";
import test from "node:test";
import { validateResult, validateThread } from "./quality-gate.js";

const records = [
  { id: "a", createdAt: "2026-01-01", text: "a", batch: 1 },
  { id: "b", createdAt: "2026-01-02", text: "b", batch: 2 },
  { id: "c", createdAt: "2026-01-03", text: "c", batch: 3 },
];

test("requires new evidence for a Thread", () => {
  assert.equal(validateThread({ id: "t", title: "t", thesis: "t", evidence: ["a", "b"], openEdges: [], status: "active" }, new Set(["c"]), new Set(["a", "b", "c"])), "thread must use a record from this batch");
});

test("requires three batches for a Possibility", () => {
  assert.equal(validateResult({ kind: "possibility", content: "x", sourceRecordIds: ["a", "b"], artifactPaths: [] }, records, "/tmp/run"), "possibility needs evidence from three batches");
});

test("requires a real Possibility artifact", () => {
  assert.equal(validateResult({ kind: "possibility", content: "x", sourceRecordIds: ["a", "b", "c"], artifactPaths: [] }, records, "/tmp/run"), "possibility needs a real artifact");
});
