import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { MediaService } from "../domain/media/index.js";
import type { Task, TaskRun, TaskRunArtifact, TaskRunResult } from "../domain/tasks/index.js";
import { assertWorkspacePath } from "../agent/workspace/paths.js";

const formats = {
  markdown: { filename: "result.md", mimeType: "text/markdown" },
  text: { filename: "result.txt", mimeType: "text/plain" },
  html: { filename: "result.html", mimeType: "text/html" },
} as const;

function formatForFilename(filename: string): Task["output"]["format"] | undefined {
  if (filename.endsWith(".md")) return "markdown";
  if (filename.endsWith(".txt")) return "text";
  if (filename.endsWith(".html")) return "html";
  return undefined;
}

export type TaskDeliveryInput = {
  summary: string;
  artifacts: Array<{ path: string; role: "primary" | "supplementary" }>;
};

export class TaskResultPublisher {
  constructor(private readonly media: MediaService) {}

  async publish(task: Task, run: TaskRun, workspace: string, workerSessionId: string, input: TaskDeliveryInput): Promise<{
    primaryMediaId: string;
    result: TaskRunResult;
  }> {
    const summary = input.summary.trim();
    if (!summary) throw new Error("交付摘要不能为空。请填写本次任务完成内容后重试。");
    if (!input.artifacts.length) throw new Error("至少需要交付一个文件。请先在工作区写入最终文件后重试。");
    const descriptor = formats[task.output.format];
    const expectedFilename = descriptor.filename;
    const primary = input.artifacts.filter(artifact => artifact.role === "primary");
    if (primary.length !== 1 || primary[0]!.path !== expectedFilename) {
      throw new Error(`主交付文件必须是相对路径 ${expectedFilename}，且只能声明一次。`);
    }
    const seen = new Set<string>();
    const completedAt = new Date();
    const artifacts: TaskRunArtifact[] = [];
    for (const artifact of input.artifacts) {
      if (!artifact.path || basename(artifact.path) !== artifact.path || seen.has(artifact.path)) {
        throw new Error("交付文件路径必须是工作区根目录下唯一的文件名。");
      }
      seen.add(artifact.path);
      assertWorkspacePath(workspace, artifact.path);
      const format = formatForFilename(artifact.path);
      if (!format) throw new Error(`${artifact.path} 不是受支持的交付文件。只允许 .md、.txt 或 .html。`);
      const absolutePath = resolve(workspace, artifact.path);
      let data: Buffer;
      try {
        const file = await stat(absolutePath);
        if (!file.isFile() || file.size === 0) throw new Error("empty");
        data = await readFile(absolutePath);
      } catch {
        throw new Error(`未找到有效的 ${artifact.path}。请先在当前工作区以相对路径写入该文件，再重新调用 deliver_task_result。`);
      }
      validateContent(format, data, artifact.path);
      const artifactDescriptor = formats[format];
      const asset = await this.media.createTaskGeneratedFile({
        userId: run.userId,
        workerSessionId,
        filename: artifact.path,
        mimeType: artifactDescriptor.mimeType,
        data,
        completedAt,
        extData: { source: "task", taskId: task.taskId, taskRunId: run.runId, workerSessionId, role: artifact.role },
      });
      artifacts.push({
        filename: artifact.path,
        role: artifact.role,
        mediaId: asset.mediaId,
        mimeType: artifactDescriptor.mimeType,
        bytes: data.byteLength,
        checksum: `sha256:${createHash("sha256").update(data).digest("hex")}`,
      });
    }
    return {
      primaryMediaId: artifacts.find(artifact => artifact.role === "primary")!.mediaId,
      result: {
        summary,
        artifacts,
      },
    };
  }
}

function validateContent(format: Task["output"]["format"], data: Buffer, filename: string): void {
  const content = data.toString("utf8").trim();
  if (!content) throw new Error(`${filename} 为空。请写入有效内容后重试。`);
  if (format === "html") {
    if (!/^(?:<!doctype\s+html[^>]*>\s*)?<html(?:\s|>)/i.test(content)) {
      throw new Error(`${filename} 不是有效的 HTML 起始结构。请写入完整 HTML 后重试。`);
    }
    assertNoLocalHtmlMedia(content, filename);
  }
  if (format === "markdown") assertNoLocalMarkdownMedia(content, filename);
}

function assertNoLocalHtmlMedia(content: string, filename: string): void {
  const sourcePattern = /<(?:img|audio|video|source)\b[^>]*\bsrc\s*=\s*(?:(["'])(.*?)\1|([^\s>]+))/gi;
  for (const match of content.matchAll(sourcePattern)) {
    const source = (match[2] ?? match[3] ?? "").trim();
    if (source && isLocalResource(source)) {
      throw new Error(`${filename} 引用了无法交付的本地媒体路径 ${source}。请改用真实的 fanto-media://<mediaId>。`);
    }
  }
}

function assertNoLocalMarkdownMedia(content: string, filename: string): void {
  const linkPattern = /!?\[[^\]]*\]\(\s*<?([^\s)>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g;
  for (const match of content.matchAll(linkPattern)) {
    const source = (match[1] ?? "").trim();
    if (!source || !isLocalResource(source)) continue;
    if (/\.(?:png|jpe?g|gif|webp|svg|m4a|mp3|wav|ogg|mp4|webm)(?:[?#].*)?$/i.test(source)) {
      throw new Error(`${filename} 引用了无法交付的本地媒体路径 ${source}。请改用真实的 fanto-media://<mediaId>。`);
    }
  }
}

function isLocalResource(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized.startsWith("#")) return false;
  if (normalized.startsWith("fanto-media://") || normalized.startsWith("http://") || normalized.startsWith("https://")
    || normalized.startsWith("//") || normalized.startsWith("data:")) return false;
  return true;
}
