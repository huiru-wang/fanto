import assert from "node:assert/strict";
import test from "node:test";
import { TtlCache } from "./ttl-cache.js";

test("TtlCache returns cached values until expiry", async () => {
  let now = 1_000;
  let loads = 0;
  const cache = new TtlCache<string, string>({ ttlMs: 30_000, maxEntries: 2, now: () => now });

  assert.equal(await cache.getOrLoad("u1", async () => { loads += 1; return "active"; }), "active");
  assert.equal(await cache.getOrLoad("u1", async () => { loads += 1; return "disabled"; }), "active");
  assert.equal(loads, 1);

  now += 30_001;
  assert.equal(await cache.getOrLoad("u1", async () => { loads += 1; return "disabled"; }), "disabled");
  assert.equal(loads, 2);
});

test("TtlCache coalesces concurrent loads", async () => {
  let resolve!: (value: string) => void;
  let loads = 0;
  const cache = new TtlCache<string, string>({ ttlMs: 30_000, maxEntries: 2 });
  const loader = () => {
    loads += 1;
    return new Promise<string>(done => { resolve = done; });
  };

  const first = cache.getOrLoad("u1", loader);
  const second = cache.getOrLoad("u1", loader);
  assert.equal(loads, 1);
  resolve("active");
  assert.equal(await first, "active");
  assert.equal(await second, "active");
});

test("TtlCache evicts the oldest entry at capacity", () => {
  const cache = new TtlCache<string, number>({ ttlMs: 30_000, maxEntries: 2 });
  cache.set("a", 1);
  cache.set("b", 2);
  cache.set("c", 3);
  assert.equal(cache.get("a"), undefined);
  assert.equal(cache.get("b"), 2);
  assert.equal(cache.get("c"), 3);
});
