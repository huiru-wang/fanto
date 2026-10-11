import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import sharp from "sharp";
import { Readable } from "node:stream";

const dir = mkdtempSync(join(tmpdir(), "fanto-client-log-"));
process.env.LOG_DIR = dir;
const { AliyunStorage: OssStorage } = await import("./storage/aliyun-storage.js");
const { CreativeImageClient, QwenImageUnderstanding } = await import("./image-client.js");
const { QwenAudioTranscription } = await import("./audio-client.js");
after(() => rmSync(dir, { recursive: true, force: true }));
const entries = () => readFileSync(join(dir, "service.log"), "utf8").trim().split("\n").map(line => JSON.parse(line.slice(line.indexOf("{"))));

test("OSS operations log success, bytes, failures and duration without keys or SDK error contents", async () => {
  const oss = new OssStorage({ region: "oss-cn-hangzhou", bucket: "fanto-test", accessKeyId: "private-key", accessKeySecret: "private-secret" });
  const failure = Object.assign(new Error("private-response https://example.com/?token=private"), { code: "AccessDenied", status: 403 });
  (oss as any).client = {
    put: async () => ({ res: { status: 200 } }),
    getStream: async () => ({ stream: Readable.from([Buffer.from("private-body")]), res: { status: 200 } }),
    head: async () => ({ res: { status: 200, headers: { "content-length": "12", "content-type": "image/png", etag: "test" } } }),
    delete: async () => { throw failure; },
  };
  await oss.putObject("private-object", Buffer.from("private-body"), "image/png");
  assert.equal((await oss.getObject("private-object")).toString(), "private-body");
  await oss.head("private-object");
  await assert.rejects(oss.remove("private-object"), (error: any) => error.code === "AccessDenied" && error.status === 403);
  const logs = entries().filter(entry => entry.service === "oss" && entry.outcome);
  assert.deepEqual(logs.map(entry => entry.operation), ["put", "get", "head", "delete"]);
  assert.equal(logs[0].bytes, 12);
  assert.equal(logs[1].bytes, 12);
  assert.equal(logs[3].outcome, "failed");
  assert.equal(logs[3].httpStatus, 403);
  assert.equal(logs[3].errorCode, "AccessDenied");
  assert.doesNotMatch(JSON.stringify(entries()), /private|https:/);
});

test("image generation/download and vision/audio log validated outcomes without model content", async () => {
  const png = await sharp({ create: { width: 32, height: 24, channels: 3, background: "white" } }).png().toBuffer();
  let calls = 0;
  const image = new CreativeImageClient({ endpoint: "https://dashscope.aliyuncs.com/generation", apiKey: "private-key", model: "test-image", timeoutMs: 1000 }, async () => ++calls === 1
    ? Response.json({ output: { choices: [{ message: { content: [{ image: "https://dashscope-test.oss-accelerate.aliyuncs.com/private.png?Signature=private" }] } }] } })
    : new Response(new Uint8Array(png)));
  const result = await image.generate({ prompt: "private-prompt", referenceUrls: ["https://example.com/private"] });
  await image.download(result.recovery);
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ choices: [{ finish_reason: "stop", message: { content: "private-description" } }] });
    await new QwenImageUnderstanding("private-key", "https://example.com").describe({ imageUrl: "https://example.com/private" });
    globalThis.fetch = async () => Response.json({ output: { choices: [{ finish_reason: "stop", message: { content: [{ text: "private-transcript" }] } }] } });
    await new QwenAudioTranscription("private-key", "https://example.com").transcribe({ audioUrl: "https://example.com/private" });
    globalThis.fetch = async () => Response.json({}, { status: 503 });
    await assert.rejects(new QwenImageUnderstanding("private-key", "https://example.com").review({ imageUrl: "private", brief: "private" }));
    await assert.rejects(new QwenAudioTranscription("private-key", "https://example.com").transcribe({ audioUrl: "private" }));
    // HTTP success with invalid model output must be logged as failure.
    globalThis.fetch = async () => Response.json({});
    await assert.rejects(new QwenImageUnderstanding("private-key", "https://example.com").describe({ imageUrl: "private" }));
  } finally { globalThis.fetch = original; }
  const logs = entries().filter(entry => entry.outcome && entry.service !== "oss");
  assert.deepEqual(logs.map(entry => entry.operation), ["generate", "download", "describe", "transcribe", "review", "transcribe", "describe"]);
  assert.equal(logs[1].downloadBytes, png.length);
  assert.equal(logs[1].width, 32);
  assert.equal(logs[1].height, 24);
  assert.equal(logs[4].httpStatus, 503);
  assert.equal(logs[6].httpStatus, 200);
  assert.equal(logs[6].outcome, "failed");
  for (const entry of entries().filter(entry => entry.outcome)) {
    assert.ok(entry.durationMs >= 0);
    assert.ok(entries().some(start => start.callId === entry.callId && !start.outcome));
  }
  assert.doesNotMatch(JSON.stringify(entries()), /private|https:|Signature/);
});
