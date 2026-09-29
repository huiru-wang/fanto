import assert from "node:assert/strict";
import test from "node:test";
import { OssStorage } from "./oss-client.js";

const storage = new OssStorage({
  region: "oss-cn-hangzhou",
  bucket: "fanto-test",
  accessKeyId: "test-access-key",
  accessKeySecret: "test-access-secret",
});

test("OSS thumbnail signed URL carries the fixed image process", () => {
  const thumbnail = decodeURIComponent(storage.readUrl("records/image.jpg", "thumbnail"));
  const original = decodeURIComponent(storage.readUrl("records/image.jpg", "original"));

  assert.match(thumbnail, /x-oss-process=image\/resize,w_600\/quality,q_80\/format,webp/);
  assert.doesNotMatch(original, /x-oss-process=/);
});
