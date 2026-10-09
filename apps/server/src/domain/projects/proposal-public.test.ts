import assert from "node:assert/strict";
import test from "node:test";
import { publicProposal } from "./repository.js";
import type { Proposal } from "./project.js";

const now = new Date("2026-10-09T00:00:00Z");
const sample: Proposal = {
  proposalId: "proposal-1", userId: "user-1", sessionId: null, type: "create", targetProjectId: null,
  title: "一组大观园写真", proposedSummary: "内部背景", status: "pending", resultProjectId: null,
  createdAt: now, updatedAt: now, resolvedAt: null,
  content: {
    reason: "只给 Agent 用的内部判断，不可直接展示给用户",
    opening: "看到你在大观园的照片，我想做一组角色写真。",
    selectedIdeaId: null,
    ideas: [{ id: "idea-1", title: "红楼梦写真", idea: "我想把原照变成红楼梦风格的换装写真。", tags: ["角色写真", "古典换装"], goal: { objective: "拍成新照片" } }],
  },
};

test("public Proposal exposes conversational opening but never internal rationale or goals", () => {
  const result = publicProposal(sample);
  assert.equal(result.content.opening, sample.content.opening);
  assert.equal(Object.hasOwn(result.content, "reason"), false);
  assert.equal(Object.hasOwn(result.content.ideas[0]!, "goal"), false);
  assert.equal(Object.hasOwn(result, "proposedSummary"), false);
});

test("legacy Proposal without opening stays compatible", () => {
  const result = publicProposal({ ...sample, content: { ...sample.content, opening: undefined } });
  assert.equal(Object.hasOwn(result.content, "opening"), false);
});
