import assert from "node:assert/strict";
import test from "node:test";
import { QwenAudioTranscription } from "./audio-client.js";

test("audio client uses the multimodal generation API and returns audio annotations", async () => {
  const originalFetch = globalThis.fetch; let url = ""; let body = "";
  globalThis.fetch = async (input, init) => { url = String(input); body = String(init?.body); return new Response(JSON.stringify({ output: { choices: [{ finish_reason: "stop", message: { content: [{ text: "完整转写" }], annotations: [{ type: "audio_info", emotion: "neutral", language: "zh" }] } }] } }), { headers: { "Content-Type": "application/json" } }); };
  try {
    const result = await new QwenAudioTranscription("token", "https://model.example/compatible-mode/v1", "qwen3-asr-plus").transcribe({ audioUrl: "https://oss.example/audio.mp3" });
    assert.deepEqual(result, { transcript: "完整转写", model: "qwen3-asr-plus", emotion: "neutral", language: "zh" }); assert.equal(url, "https://model.example/api/v1/services/aigc/multimodal-generation/generation");
    assert.deepEqual(JSON.parse(body), { model: "qwen3-asr-plus", input: { messages: [{ role: "user", content: [{ audio: "https://oss.example/audio.mp3" }] }] }, parameters: { asr_options: { enable_itn: false } } });
  } finally { globalThis.fetch = originalFetch; }
});
