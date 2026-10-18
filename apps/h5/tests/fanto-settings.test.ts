import assert from "node:assert/strict";
import test from "node:test";
import { cropGeometry } from "../src/fanto/crop.js";
import { rebaseText } from "../src/fanto/settings-state.js";
import type { FantoSettings } from "../src/api/fanto.js";
test("crop clamps all edges and preserves a square source region at every zoom", () => {
    for (const [w, h] of [[400, 800], [800, 400], [512, 512]])
        for (const zoom of [1, 2, 5])
            for (const x of [-10000, 0, 10000])
                for (const y of [-10000, 0, 10000]) {
                    const g = cropGeometry(w!, h!, 300, { zoom, x, y });
                    assert.ok(g.sourceX >= 0 && g.sourceY >= 0);
                    assert.ok(g.sourceX + g.side <= w! + 1e-6 && g.sourceY + g.side <= h! + 1e-6);
                    assert.ok(g.side >= 128 - 1e-6);
                }
});
test("avatar saves preserve text drafts and detect remote conflicts instead of silently rebasing them", () => {
    const base: FantoSettings = { nickname: "Fanto", description: "", avatarMediaId: null, roleConfig: { character: "old", scenario: "", instructions: "", exampleDialogues: "" }, version: 1, createdAt: null, updatedAt: null };
    const draft = { ...base, nickname: "mine", roleConfig: { ...base.roleConfig, character: "local" } }, remote = { ...base, avatarMediaId: "new-image", nickname: "remote", version: 2 };
    const result = rebaseText(base, draft, remote);
    assert.equal(result.draft.avatarMediaId, "new-image");
    assert.equal(result.draft.nickname, "mine");
    assert.equal(result.draft.roleConfig.character, "local");
    assert.deepEqual(result.conflicts, ["nickname"]);
});
