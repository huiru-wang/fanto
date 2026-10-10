import type { Context } from "@earendil-works/pi-agent-core";
import type { AgentBusinessServices } from "../../business-services.js";
import { createRunContext } from "../run-context.js";

const MAX_PROJECT_CONTENT_CHARS = 16_000;
const MAX_RECORD_TEXT_CHARS = 2_500;
const MAX_RECORD_BLOCK_CHARS = 800;
const MAX_RECORD_BLOCKS = 20;

function excerpt(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}\n（内容较长，已截断；需要完整内容请使用读取工具。）` : value;
}

/** Project/Goal/Records share one server authorization but occupy distinct prompt sections. */
export class CreatorContextProvider {
  readonly slots = ["creator_goal", "creator_project", "creator_records"] as const;
  readonly required = true;
  constructor(private readonly client: AgentBusinessServices) {}

  async build(context: Context): Promise<Record<(typeof this.slots)[number], string>> {
    const run = createRunContext.read(context);
    if (!run.projectId || run.recordId || run.recordVersion !== undefined || !this.client.creativeContext) {
      throw new Error("CREATIVE_AUTHORITY_REQUIRED");
    }
    const data = await this.client.creativeContext({
      userId: run.userId, sessionId: run.sessionId,
      projectId: run.projectId, signal: context.abortSignal,
    });
    if (!("goal" in data) || !data.goal || !data.project || !data.records) throw new Error("CREATOR_CONTEXT_INVALID");

    const project = data.project;
    const records = data.records.data.map(record => ({
      recordId: record.id,
      eventAt: record.eventAt,
      content: {
        text: excerpt(record.content.text ?? "", MAX_RECORD_TEXT_CHARS),
        blocks: record.content.blocks.slice(0, MAX_RECORD_BLOCKS).map(block => {
          const value = { ...block };
          if ("description" in value && typeof value.description === "string") value.description = excerpt(value.description, MAX_RECORD_BLOCK_CHARS);
          if ("transcription" in value && typeof value.transcription === "string") value.transcription = excerpt(value.transcription, MAX_RECORD_BLOCK_CHARS);
          return value;
        }),
        omittedBlocks: Math.max(0, record.content.blocks.length - MAX_RECORD_BLOCKS),
      },
    }));

    return {
      creator_goal: JSON.stringify(data.goal, null, 2),
      creator_project: JSON.stringify({
        projectId: project.projectId,
        title: project.title,
        summary: project.summary,
        status: project.status,
        version: project.version,
        content: project.content ? excerpt(project.content, MAX_PROJECT_CONTENT_CHARS) : "（暂无作品内容）",
      }, null, 2),
      creator_records: JSON.stringify({
        records,
        hasMore: data.records.hasMore,
        note: "这里是已授权 Project 关联记录的有界预览；需要完整 Record 时按真实 recordId 调用 record_read。Create 和 Extend 的本轮新增 Record IDs 也由执行指令提供。",
      }, null, 2),
    };
  }
}
