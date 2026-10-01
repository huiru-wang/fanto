import assert from "node:assert/strict";
import test from "node:test";
import { parseSaveRecord } from "./content.js";

test("Record accepts a media-only entry", () => {
  assert.deepEqual(parseSaveRecord({
    text: "",
    media: [{ mediaId: "ce2f5608-b2ce-4c1e-a28e-cb0c225494d8" }],
  }), {
    text: "",
    media: [{ mediaId: "ce2f5608-b2ce-4c1e-a28e-cb0c225494d8" }],
  });
});

test("Record rejects an entry without text or media", () => {
  assert.throws(() => parseSaveRecord({ text: "  ", media: [] }));
});
