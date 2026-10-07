import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { CreativeImageClient } from "./creative-image-client.js";
const options = { endpoint: "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation", apiKey: "test-only", model: "qwen-image-3.0-pro", timeoutMs: 1000 };
const vendor = "https://dashscope-test.oss-accelerate.aliyuncs.com/result.png?Expires=123&Signature=private";
test("native image API protocol, encrypted recovery URL and verified PNG download", async () => {
  const png = await sharp({ create: { width: 512, height: 512, channels: 3, background: "white" } }).png().toBuffer();
  let calls = 0;
  const client = new CreativeImageClient(options, async (url, init) => {
    calls++;
    if (calls === 1) {
      assert.equal(url, options.endpoint); assert.equal(init?.redirect, "error");
      const body = JSON.parse(init?.body as string);
      assert.equal(body.model, options.model); assert.equal(body.parameters.n, 1); assert.equal(body.parameters.prompt_extend_mode, "direct");
      assert.deepEqual(body.input.messages[0].content, [{ image: "https://owned.example/source.jpg" }, { text: "edit clothes" }]);
      return Response.json({ output: { choices: [{ message: { content: [{ type: "image", image: vendor }] } }] } });
    }
    assert.equal(String(url), vendor); assert.equal(init?.redirect, "error");
    return new Response(new Uint8Array(png));
  });
  const response = await client.generate({ prompt: "edit clothes", referenceUrls: ["https://owned.example/source.jpg"] });
  assert.doesNotMatch(JSON.stringify(response), /Signature|aliyuncs|private/);
  const image = await client.download(response.recovery); assert.equal(image.width, 512); assert.equal(image.height, 512); assert.equal(image.mimeType, "image/png");
  await assert.rejects(new CreativeImageClient({ ...options, apiKey: "rotated-key" }).download(response.recovery), /IMAGE_RECOVERY_UNAVAILABLE/);
});
test("uncertain requests are not retried; disallowed URLs and non-images are rejected", async () => {
  let calls = 0;
  const broken = new CreativeImageClient(options, async () => { calls++; throw new Error("network lost"); });
  await assert.rejects(broken.generate({ prompt: "edit", referenceUrls: ["https://source.example"] }), /IMAGE_RESULT_UNKNOWN/); assert.equal(calls, 1);
  const rejected = new CreativeImageClient(options, async () => new Response("rejected", { status: 400 }));
  await assert.rejects(rejected.generate({ prompt: "edit", referenceUrls: ["https://source.example"] }), /IMAGE_GENERATION_REJECTED/);
  const evil = new CreativeImageClient(options, async () => Response.json({ output: { choices: [{ message: { content: [{ image: "http://127.0.0.1/secret" }] } }] } }));
  await assert.rejects(evil.generate({ prompt: "edit", referenceUrls: ["https://source.example"] }), /IMAGE_GENERATION_INVALID_RESPONSE/);
  let generated = false;
  const fakeImage = new CreativeImageClient(options, async () => {
    if (generated) return new Response("<html>not an image</html>");
    generated = true; return Response.json({ output: { choices: [{ message: { content: [{ image: vendor }] } }] } });
  });
  await assert.rejects(fakeImage.download((await fakeImage.generate({ prompt: "edit", referenceUrls: ["https://source.example"] })).recovery), /IMAGE_SAVE_RETRYABLE/);
});
