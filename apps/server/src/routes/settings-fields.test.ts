import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../bootstrap/app.js";
import { FantoService } from "../domain/fanto/fanto-service.js";
import { defaultSettings, type SettingsChanges } from "../domain/fanto/model.js";
import type { UserProfileService } from "../domain/users/profile-service.js";
import type { MediaService } from "../domain/media/index.js";

const auth = { sessions: { verify: async (userId: string) => ({ userId }) }, assertActiveUser: async () => {} } as never;
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

test("Fanto API forwards per-role agent settings, never permits an identity patch",async()=>{
 const received:unknown[]=[];
 const service={patch:async (userId:string,input:unknown)=>{received.push([userId,input]);return {version:2};}} as unknown as FantoService;
 const app=createApp({auth,fanto:service,records:{} as never,media:{} as never});
 const body={fantoId:"a1111111-1111-4111-8111-111111111111",expectedVersion:1,changes:{agentConfig:{narrationEnabled:true}}};
 const response=await app.request("/api/fanto",{method:"PATCH",headers,body:JSON.stringify(body)});
 assert.equal(response.status,200);assert.deepEqual(received,[["owner",body]]);
 const changed={...body,changes:{roleConfig:{character:"new"}}};
 assert.equal((await app.request("/api/fanto",{method:"PATCH",headers,body:JSON.stringify(changed)})).status,400);
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


test("Fanto PATCH never accepts session rebinding",async()=>{
 const app=createApp({auth,fanto:{patch:async()=>({})} as never,records:{} as never,media:{} as never});
 const body={fantoId:"a1111111-1111-4111-8111-111111111111",expectedVersion:1,changes:{sessionId:"a1111111-1111-4111-8111-111111111112"}};
 assert.equal((await app.request("/api/fanto",{method:"PATCH",headers,body:JSON.stringify(body)})).status,400);
});
