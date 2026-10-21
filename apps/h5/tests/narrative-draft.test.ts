import assert from "node:assert/strict";
import test from "node:test";
import { draftPart, serializeDraft, parseDraft, restoreDraft, insertNarration, finishNarration } from "../src/components/narrative-draft.js";

test("alternating description and language uses explicit quote boundaries and round trips", () => {
  const parts = [draftPart("narration", "推开门"), draftPart("speech", "我回来了。"), draftPart("narration", "屋里很安静\n只有一盏灯"), draftPart("speech", "在等我吗？"), draftPart("narration", "坐下")];
  const wire = serializeDraft(parts);
  assert.equal(wire, "> 推开门\n\n我回来了。\n\n> 屋里很安静\n> 只有一盏灯\n\n在等我吗？\n\n> 坐下");
  assert.equal(serializeDraft(parseDraft(wire)), wire);
});
test("empty description is never sent as a quote marker", () => {
  assert.equal(serializeDraft([draftPart("narration")]), "");
  assert.equal(serializeDraft([draftPart("speech", "你好"), draftPart("narration", "  ")]), "你好");
});
test("adding description at caret preserves both sides and selected text", () => {
  const speech = draftPart("speech", "你好世界");
  const result = insertNarration([speech], speech.id, 1, 3);
  assert.deepEqual(result.parts.map(({ kind, text }) => ({ kind, text })), [
    { kind: "speech", text: "你" }, { kind: "narration", text: "好世" }, { kind: "speech", text: "界" },
  ]);
  assert.equal(result.parts[1]!.id, result.focusId);
  const empty = draftPart();
  assert.equal(insertNarration([empty], empty.id, 0, 0).parts.length, 1);
});
test("Enter finishes description and targets language without sending", () => {
  const action = draftPart("narration", "放下伞"), speech = draftPart("speech");
  const result = finishNarration([action, speech], action.id, 3, 3);
  assert.equal(result.focusId, speech.id);
  assert.equal(result.parts.length, 2);
  const middle = finishNarration([action], action.id, 2, 2);
  assert.equal(middle.parts[1]!.kind, "speech");
  assert.equal(middle.parts[1]!.text, "伞");
});
test("structured drafts preserve empty active modes; legacy plain drafts still restore", () => {
  const parts = [draftPart("speech", "你好"), draftPart("narration")];
  const restored = restoreDraft(JSON.stringify({ version: 1, parts }));
  assert.equal(restored[1]!.kind, "narration");
  assert.equal(restored[1]!.text, "");
  assert.equal(serializeDraft(restoreDraft("> 起身\n\n你好")), "> 起身\n\n你好");
  assert.equal(serializeDraft(restoreDraft("普通草稿")), "普通草稿");
});
