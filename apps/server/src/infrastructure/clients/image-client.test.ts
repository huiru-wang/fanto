import assert from "node:assert/strict";
import test from "node:test";
import { QwenImageUnderstanding } from "./image-client.js";

test("image client uses its configured vision model", async () => {
  const originalFetch = globalThis.fetch; let body = "";
  globalThis.fetch = async (_input, init) => { body = String(init?.body); return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "一张风景照片。" } }] }), { headers: { "Content-Type": "application/json" } }); };
  try {
    const result = await new QwenImageUnderstanding("token", "https://model.example/v1", "qwen3-vl-plus").describe({ imageUrl: "https://oss.example/image.jpg" });
    assert.deepEqual(result, { description: "一张风景照片。" });
    assert.equal(JSON.parse(body).model, "qwen3-vl-plus");
  } finally { globalThis.fetch = originalFetch; }
});
