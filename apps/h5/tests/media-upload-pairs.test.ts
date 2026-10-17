import assert from "node:assert/strict";
import test from "node:test";
import { uploadInPairs } from "../src/api/media-upload.js";

test("uploads at most two media pipelines together and preserves selected order", async () => {
  let active = 0;
  let maxActive = 0;
  const waves: string[] = [];
  const ids = await uploadInPairs([0, 1, 2, 3, 4], async index => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise(resolve => setTimeout(resolve, index % 2 === 0 ? 15 : 2));
    active -= 1;
    return `media-${index}`;
  }, (first, last) => waves.push(`${first}-${last}`));
  assert.equal(maxActive, 2);
  assert.deepEqual(waves, ["1-2", "3-4", "5-5"]);
  assert.deepEqual(ids, ["media-0", "media-1", "media-2", "media-3", "media-4"]);
});

test("on failure settles in-flight uploads, stops new batches, and permits explicit retry", async () => {
  const cached = new Map<number, string>();
  const calls: number[] = [];
  let active = 0;
  const upload = async (index: number) => {
    if (cached.has(index)) return cached.get(index)!;
    calls.push(index);
    active += 1;
    await new Promise(resolve => setTimeout(resolve, index === 1 ? 5 : 15));
    active -= 1;
    if (index === 1 && calls.filter(value => value === 1).length === 1) throw new Error("upload failed");
    cached.set(index, `media-${index}`);
    return `media-${index}`;
  };
  await assert.rejects(uploadInPairs([0, 1, 2], upload), /upload failed/);
  assert.equal(active, 0);
  assert.deepEqual(calls, [0, 1]);
  const ids = await uploadInPairs([0, 1, 2], upload);
  assert.deepEqual(ids, ["media-0", "media-1", "media-2"]);
  assert.deepEqual(calls, [0, 1, 1, 2]);
});
