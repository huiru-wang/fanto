import assert from "node:assert/strict";
import test from "node:test";
import { MediaService } from "./media-service.js";

test("generated file uploads to OSS before creating ready media", async () => {
  const calls: string[] = [];
  const repository = {
    createReadyFile: async (input: any) => {
      calls.push(`db:${input.objectKey}`);
      return {
        mediaId: input.mediaId,
        userId: input.userId,
        objectKey: input.objectKey,
        mediaType: "file",
        mimeType: input.mimeType,
        bytes: input.bytes,
        status: "ready",
        extData: input.extData,
        createdAt: "",
        updatedAt: "",
      };
    },
  };
  const oss = {
    putObject: async (key: string, data: Buffer, mimeType: string) => {
      calls.push(`oss:${key}:${data.toString("utf8")}:${mimeType}`);
    },
    remove: async () => {},
  };
  const service = new MediaService(repository as never, oss as never);

  const asset = await service.createGeneratedFile({
    userId: "user-1",
    filename: "result.md",
    mimeType: "text/markdown",
    data: Buffer.from("hello"),
    extData: { source: "task" },
  });

  assert.match(asset.objectKey, /^users\/user-1\/media\/[0-9a-f-]+\/result\.md$/);
  assert.equal(asset.mediaType, "file");
  assert.deepEqual(asset.extData, { source: "task", filename: "result.md" });
  assert.equal(calls.length, 2);
  assert.match(calls[0]!, /^oss:/);
  assert.match(calls[1]!, /^db:/);
});
