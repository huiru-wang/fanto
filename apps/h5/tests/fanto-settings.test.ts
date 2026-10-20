import assert from "node:assert/strict";
import test from "node:test";
import { cropGeometry } from "../src/fanto/crop.js";
import { configChanges, mergeFanto, rebaseConfig, usableSelection } from "../src/fanto/settings-state.js";
import type { FantoSettings } from "../src/api/fanto.js";

const role = (fantoId: string, version = 1): FantoSettings => ({ fantoId, userId: "owner", nickname: "", description: "", avatarMediaId: null,
  sessionId: `session-${fantoId}`, roleConfig: { character: "", scenario: "", instructions: "", exampleDialogues: "" },
  agentConfig: { recordReadEnabled: false, userMemoryEnabled: false, narrationEnabled: false },
  status: "active", archivedAt: null, version, createdAt: "2026-10-21T00:00:00Z", updatedAt: "2026-10-21T00:00:00Z" });

test("crop clamps all edges and preserves a square source region at every zoom", () => {
  for (const [w, h] of [[400, 800], [800, 400], [512, 512]])
    for (const zoom of [1, 2, 5]) for (const x of [-10000, 0, 10000]) for (const y of [-10000, 0, 10000]) {
      const g = cropGeometry(w!, h!, 300, { zoom, x, y });
      assert.ok(g.sourceX >= 0 && g.sourceY >= 0);
      assert.ok(g.sourceX + g.side <= w! + 1e-6 && g.sourceY + g.side <= h! + 1e-6);
      assert.ok(g.side >= 128 - 1e-6);
    }
});
test("capability saves contain only changed keys, never identity or Session", () => {
  const base = role("one");
  assert.deepEqual(configChanges(base.agentConfig, { ...base.agentConfig, userMemoryEnabled: true }), { agentConfig: { userMemoryEnabled: true } });
  assert.deepEqual(configChanges(base.agentConfig, base.agentConfig), {});
});
test("an independent avatar save rebases capability drafts without losing other remote changes", () => {
  const base = role("one").agentConfig;
  const draft = { ...base, narrationEnabled: true }, remote = { ...base, userMemoryEnabled: true };
  const result = rebaseConfig(base, draft, remote);
  assert.deepEqual(result.draft, { ...remote, narrationEnabled: true });
  assert.deepEqual(result.conflicts, []);
});
test("versions are compared per role; old responses cannot replace newer config or other roles", () => {
  const first = role("one", 8), second = role("two", 1);
  const rows = mergeFanto([first], second);
  assert.equal(rows.length, 2);
  assert.equal(mergeFanto(rows, role("one", 2)).find(item => item.fantoId === "one")?.version, 8);
  assert.equal(mergeFanto(rows, role("two", 2)).find(item => item.fantoId === "two")?.version, 2);
  assert.equal(usableSelection("one", mergeFanto(rows, { ...role("one", 2), status: "archived" })), "one", "stale archived responses must not deselect a restored active role");
});
test("archive or delete falls back to default Main rather than another role's history", () => {
  assert.equal(usableSelection("one", [role("one"), role("two")]), "one");
  assert.equal(usableSelection("one", [{ ...role("one"), status: "archived" }, role("two")]), null);
  assert.equal(usableSelection("one", [role("two")]), null);
  assert.equal(usableSelection(null, [role("two")]), null);
});
