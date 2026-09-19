import assert from "node:assert/strict";
import test from "node:test";
import { EmbeddingsClient } from "./embeddings-client.js";

test("embeddings client requests the configured dimension in OpenAI-compatible format", async () => {
  const originalFetch = globalThis.fetch; let url = ""; let body = "";
  globalThis.fetch = async (input, init) => {
    url = String(input); body = String(init?.body);
    return new Response(JSON.stringify({ data: [{ embedding: Array.from({ length: 768 }, () => 0.1) }] }), { headers: { "Content-Type": "application/json" } });
  };
  try {
    const embedding = await new EmbeddingsClient("token", "https://model.example/compatible-mode/v1", "qwen3.7-text-embedding-flash", 768).embed("个人记录");
    assert.equal(url, "https://model.example/compatible-mode/v1/embeddings");
    assert.equal(embedding.length, 768);
    assert.deepEqual(JSON.parse(body), { model: "qwen3.7-text-embedding-flash", input: "个人记录", dimensions: 768, encoding_format: "float" });
  } finally { globalThis.fetch = originalFetch; }
});
