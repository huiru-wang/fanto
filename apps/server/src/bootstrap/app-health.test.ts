import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "./app.js";

const services = (healthCheck: () => Promise<void>) => ({
  records: {} as never,
  media: {} as never,
  healthCheck,
});

test("health reports overall service availability", async () => {
  const app = createApp(services(async () => {}));
  const response = await app.request("/health");
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json() as any).database, "ok");
});

test("health fails when the database is unavailable and ready is not exposed", async () => {
  const app = createApp(services(async () => { throw new Error("database unavailable"); }));
  const health = await app.request("/health");
  assert.equal(health.status, 503);
  assert.equal((await health.json() as any).status, "unavailable");
  assert.equal((await app.request("/ready")).status, 404);
});
