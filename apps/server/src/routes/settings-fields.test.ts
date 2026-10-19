import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../bootstrap/app.js";
import { FantoService } from "../domain/fanto/fanto-service.js";
import { defaultSettings, type SettingsChanges } from "../domain/fanto/model.js";
import type { UserProfileService } from "../domain/users/profile-service.js";
import type { MediaService } from "../domain/media/index.js";

const auth = { verifyAccess: async (userId: string) => ({ userId }), assertActiveUser: async () => {} } as never;
const headers = { Authorization: "Bearer owner", "Content-Type": "application/json" };

test("profile PATCH forwards only the selected field, including an explicit cover reset", async () => {
  const received: unknown[] = [];
  const service = { update: async (userId: string, input: unknown) => {
    assert.equal(userId, "owner"); received.push(input); return { version: received.length };
  } } as unknown as UserProfileService;
  const app = createApp({ auth, userProfile: service, records: {} as never, media: {} as never });
  for (const changes of [{ nickname: "新昵称" }, { signature: "" }, { avatarMediaId: "new-avatar" }, { coverMediaId: "new-cover" }, { coverMediaId: null }]) {
    const input = { expectedVersion: received.length, changes };
    const response = await app.request("/api/users/me/profile", { method: "PATCH", headers, body: JSON.stringify(input) });
    assert.equal(response.status, 200);
    assert.deepEqual(received.at(-1), input);
  }
});

test("each Fanto prompt can be saved separately without submitting the other prompts", async () => {
  let received: SettingsChanges | undefined;
  const service = new FantoService({ find: async () => null, update: async (userId, version, changes) => {
    assert.equal(userId, "owner"); assert.equal(version, 7);
    received = changes;
    return { ...defaultSettings(), version: 8 };
  } }, { validateAvatar: async () => true });
  const app = createApp({ auth, fanto: service, records: {} as never, media: {} as never });
  for (const field of ["character", "scenario", "instructions", "exampleDialogues"]) {
    const changes = { roleConfig: { [field]: field === "scenario" ? "" : "只保存这一项\n保留换行" } };
    const response = await app.request("/api/fanto/settings", { method: "PATCH", headers, body: JSON.stringify({ expectedVersion: 7, changes }) });
    assert.equal(response.status, 200);
    assert.deepEqual(received, changes);
  }
});

test("authenticated upload route accepts user_cover and forwards its isolated purpose", async () => {
  let received: unknown;
  const media = { createUpload: async (userId: string, input: unknown) => {
    assert.equal(userId, "owner"); received = input;
    return { mediaId: "cover", uploadUrl: "https://storage.example/cover", expiresAt: new Date().toISOString() };
  } } as unknown as MediaService;
  const app = createApp({ auth, records: {} as never, media });
  const input = { mimeType: "image/jpeg", bytes: 1024, purpose: "user_cover" };
  const response = await app.request("/api/uploads", { method: "POST", headers, body: JSON.stringify(input) });
  assert.equal(response.status, 201);
  assert.deepEqual(received, input);
  assert.equal((await app.request("/api/uploads", { method: "POST", headers, body: JSON.stringify({ ...input, bytes: 2 * 1024 * 1024 + 1 }) })).status, 413);
});


test("session rebinding accepts only the owned main session and only submits sessionId", async () => {
  const sessionId = "10000000-0000-4000-8000-000000000001";
  const fantoId = "20000000-0000-4000-8000-000000000001";
  const current = { ...defaultSettings(), fantoId, nickname: "保持角色", version: 3 };
  const service = new FantoService({ find: async () => current, update: async (userId, version, changes) => {
    assert.equal(userId, "owner"); assert.equal(version, 3);
    assert.deepEqual(changes, { sessionId });
    return { ...current, ...changes, version: 4 };
  } }, { validateAvatar: async () => true }, async (userId, id) => userId === "owner" && id === sessionId);
  const app = createApp({ auth, fanto: service, records: {} as never, media: {} as never });
  const patch = (changes: unknown, owner = "owner") => app.request("/api/fanto/settings", {
    method: "PATCH", headers: { ...headers, Authorization: `Bearer ${owner}` },
    body: JSON.stringify({expectedVersion: 3, changes}),
  });
  const response = await patch({ sessionId });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json() as any).result, { ...current, sessionId, version: 4 });
  assert.equal((await patch({ sessionId }, "outsider")).status, 422);
  assert.equal((await patch({ sessionId: "not-a-uuid" })).status, 400);
  assert.equal((await patch({ fantoId })).status, 400);
  assert.equal((await patch({ mainSessionId: sessionId })).status, 400);
});
