import assert from "node:assert/strict";
import test from "node:test";
import { cropGeometry } from "../src/fanto/crop.js";
import { configChanges, matchingDefaultFanto, mergeFanto, nicknameError, rebaseConfig, usableSelection } from "../src/fanto/settings-state.js";
import type { FantoSettings } from "../src/api/fanto.js";

const role = (fantoId: string, version = 1, nickname = fantoId): FantoSettings => ({
  fantoId, userId: "owner", nickname, description: "", avatarMediaId: null,
  sessionId: `session-${fantoId}`, roleConfig: { character: "", scenario: "", instructions: "", exampleDialogues: "" },
  agentConfig: { recordReadEnabled: false, fantoMemoryEnabled: true, narrationEnabled: false },
  status: "active", archivedAt: null, version, createdAt: "2026-10-21T00:00:00Z", updatedAt: "2026-10-21T00:00:00Z",
});
const defaultRole = role("default-fanto-id", 1, "fanto");

test("crop clamps all edges and preserves a square source region at every zoom", () => {
  for (const [w, h] of [[400, 800], [800, 400], [512, 512]])
    for (const zoom of [1, 2, 5]) for (const x of [-10000, 0, 10000]) for (const y of [-10000, 0, 10000]) {
      const g = cropGeometry(w!, h!, 300, { zoom, x, y });
      assert.ok(g.sourceX >= 0 && g.sourceY >= 0);
      assert.ok(g.sourceX + g.side <= w! + 1e-6 && g.sourceY + g.side <= h! + 1e-6);
      assert.ok(g.side >= 128 - 1e-6);
    }
});
test("capability saves contain only changed fantoMemoryEnabled, never identity or Session", () => {
  const base = role("one");
  assert.deepEqual(configChanges(base.agentConfig, { ...base.agentConfig, fantoMemoryEnabled: false }),
    { agentConfig: { fantoMemoryEnabled: false } });
  assert.deepEqual(configChanges(base.agentConfig, base.agentConfig), {});
});
test("independent avatar save rebases capability drafts without losing unrelated remote changes", () => {
  const base = role("one").agentConfig;
  const draft = { ...base, narrationEnabled: true }, remote = { ...base, fantoMemoryEnabled: false };
  const result = rebaseConfig(base, draft, remote);
  assert.deepEqual(result.draft, { ...remote, narrationEnabled: true });
  assert.deepEqual(result.conflicts, []);
});
test("versions are compared per role; old responses cannot replace newer settings", () => {
  const first = role("one", 8), second = role("two", 1);
  const rows = mergeFanto([defaultRole, first], second);
  assert.equal(rows.length, 3);
  assert.equal(mergeFanto(rows, role("one", 2)).find(item => item.fantoId === "one")?.version, 8);
  assert.equal(mergeFanto(rows, role("two", 2)).find(item => item.fantoId === "two")?.version, 2);
  assert.equal(usableSelection("one", mergeFanto(rows, { ...role("one", 2), status: "archived" }), defaultRole.fantoId), "one");
});
test("deleted, archived, legacy default or unknown selections fall back to real fantoId", () => {
  const live = [defaultRole, role("one"), role("two")];
  assert.equal(usableSelection("one", live, defaultRole.fantoId), "one");
  assert.equal(usableSelection("one", [{ ...role("one"), status: "archived" }, defaultRole], defaultRole.fantoId), defaultRole.fantoId);
  assert.equal(usableSelection("one", [defaultRole], defaultRole.fantoId), defaultRole.fantoId);
  assert.equal(usableSelection("default", live, defaultRole.fantoId), defaultRole.fantoId);
  assert.equal(usableSelection(null, live, defaultRole.fantoId), defaultRole.fantoId);
  assert.equal(usableSelection("other-user-id", live, defaultRole.fantoId), defaultRole.fantoId);
  assert.equal(usableSelection("one", [role("one")], null), "one");
  assert.equal(usableSelection("default", [role("one")], null), null, "never use another role's Session for a missing default");
});
test("nickname validation rejects blank, default/reserved and archived duplicate names", () => {
  const archived = { ...role("archived", 1, "知晚"), status: "archived" } as const;
  const rows = [defaultRole, role("first", 1, "Alice"), archived];
  assert.match(nicknameError("  ", rows) ?? "", /请输入/);
  assert.match(nicknameError("fanto", rows) ?? "", /已存在/);
  assert.match(nicknameError(" FANTO ", rows) ?? "", /已存在/);
  assert.match(nicknameError("alice", rows) ?? "", /已存在/);
  assert.match(nicknameError(" 知晚 ", rows) ?? "", /已存在/);
  assert.match(nicknameError("a".repeat(31), rows) ?? "", /30/);
  assert.equal(nicknameError(" New Role ", rows), null);
});

test("default Session binding requires matching role ID, session ID, owner and active status", () => {
  const rows = [defaultRole, role("other")];
  const session = { agentId: "main", scopeKey: defaultRole.fantoId, sessionId: defaultRole.sessionId };
  assert.equal(matchingDefaultFanto(rows, session, "owner")?.fantoId, defaultRole.fantoId);
  assert.equal(matchingDefaultFanto(rows, { ...session, sessionId: "wrong" }, "owner"), null);
  assert.equal(matchingDefaultFanto(rows, { ...session, scopeKey: "other" }, "owner"), null);
  assert.equal(matchingDefaultFanto(rows, { ...session, agentId: "other" }, "owner"), null);
  assert.equal(matchingDefaultFanto(rows, session, "other-user"), null);
  assert.equal(matchingDefaultFanto([{ ...defaultRole, status: "archived" }], session, "owner"), null);
});
