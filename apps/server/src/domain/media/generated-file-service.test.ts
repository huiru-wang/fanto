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

test("task artifact preview only reads ready task text files owned by the user", async () => {
  const repository = {
    findMedia: async (id: string, userId: string) => {
      assert.equal(id, "media-1");
      assert.equal(userId, "user-1");
      return {
        mediaId: id,
        userId,
        objectKey: "users/user-1/task/2026-09/session/result.html",
        mediaType: "file",
        mimeType: "text/html",
        bytes: 18,
        status: "ready",
        extData: { source: "task", taskId: "task-1", taskRunId: "run-1", filename: "result.html" },
        createdAt: "",
        updatedAt: "",
      };
    },
  };
  const oss = { getObject: async () => Buffer.from("<html>ok</html>") };
  const service = new MediaService(repository as never, oss as never);

  assert.deepEqual(await service.readTaskArtifact("user-1", "media-1"), {
    kind: "ok",
    artifact: {
      mediaId: "media-1",
      taskId: "task-1",
      taskRunId: "run-1",
      filename: "result.html",
      mimeType: "text/html",
      bytes: 18,
      content: "<html>ok</html>",
    },
  });
});

test("task artifact preview rejects ordinary files", async () => {
  const repository = {
    findMedia: async () => ({
      mediaId: "media-1",
      userId: "user-1",
      objectKey: "users/user-1/media/media-1/file.html",
      mediaType: "file",
      mimeType: "text/html",
      bytes: 10,
      status: "ready",
      extData: { source: "generated", filename: "file.html" },
      createdAt: "",
      updatedAt: "",
    }),
  };
  const service = new MediaService(repository as never, { getObject: async () => Buffer.from("unused") } as never);
  assert.deepEqual(await service.readTaskArtifact("user-1", "media-1"), { kind: "not_found" });
});
