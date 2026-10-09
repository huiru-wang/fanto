import assert from "node:assert/strict";
import test from "node:test";
import cases from "./cases.json" with { type: "json" };

test("quality benchmark spans multiple everyday domains and adversarial create/extend/skip pairs", () => {
  assert.ok(cases.length>=30);
  assert.ok(new Set(cases.map(c=>c.domain)).size>=10);
  assert.deepEqual(new Set(cases.map(c=>c.expected.decision)),new Set(["create","extend","no_proposal"]));
  assert.ok(cases.some(c=>c.existingProject!==null&&c.expected.decision==="no_proposal"));
  assert.ok(cases.some(c=>c.existingProject!==null&&c.expected.decision==="create"));
  assert.ok(cases.some(c=>c.existingProject===null&&c.expected.decision==="no_proposal"));
  assert.ok(cases.every(c=>c.expected.decision!=="extend"||Boolean(c.expected.changeKind)));
  assert.equal(new Set(cases.map(c=>c.id)).size,cases.length);
});
