import { Type } from "typebox";
import type { Context } from "@earendil-works/pi-agent-core";
import type { AgentBusinessServices } from "../business-services.js";
import { createRunContext } from "../context/index.js";
import type { FantoTool } from "./types.js";

const string = (max = 2000) => Type.String({ minLength: 1, maxLength: max });
const goal = Type.Object({
  objective: string(4000), context: Type.Optional(string(12000)),
  constraints: Type.Optional(Type.Array(string(1000), { maxItems: 20 })),
  successCriteria: Type.Optional(Type.Array(string(1000), { maxItems: 20 })),
}, { additionalProperties: false });
const projectRead = Type.Object({ action: Type.Union([Type.Literal("search"), Type.Literal("get")]),
  projectId: Type.Optional(string(100)), query: Type.Optional(string()) }, { additionalProperties: false });
const idea = Type.Object({ title: string(40), idea: string(240), tags: Type.Array(string(12), { minItems: 2, maxItems: 4 }), goal }, { additionalProperties: false });
const change = Type.Object({
  kind: Type.Union([Type.Literal("enrich"),Type.Literal("correct"),Type.Literal("refine"),Type.Literal("continue")]),
  title: string(40), idea: string(240), tags: Type.Array(string(12), { minItems: 2, maxItems: 4 }),
  instruction: string(3000),
}, { additionalProperties: false });
const proposal = Type.Object({
  type: Type.Union([Type.Literal("create"), Type.Literal("extend")]),
  targetProjectId: Type.Optional(string(100)), title: string(200), proposedSummary: Type.Optional(string(2000)),
  recordIds: Type.Array(string(100), { minItems: 1, maxItems: 100 }),
  content: Type.Union([
    Type.Object({ reason: string(10000), ideas: Type.Array(idea, { minItems: 1, maxItems: 2 }) }, { additionalProperties: false }),
    Type.Object({ reason: string(10000), change }, { additionalProperties: false }),
  ]),
}, { additionalProperties: false });
const image = Type.Object({ prompt: string(6000),
  referenceMediaIds: Type.Array(string(100), { minItems: 1, maxItems: 10 }),
  aspectRatio: Type.Optional(Type.Union([Type.Literal("portrait"), Type.Literal("landscape"), Type.Literal("square")])) }, { additionalProperties: false });
const review = Type.Object({ mediaId: string(100), referenceMediaIds: Type.Optional(Type.Array(string(100), {maxItems: 4})), brief: string(2000) }, { additionalProperties: false });
const manage = Type.Object({
  action: Type.Union([Type.Literal("create"), Type.Literal("update")]),
  projectId: Type.Optional(string(100)), expectedVersion: Type.Optional(Type.Integer({minimum:1})),
  title: Type.Optional(string(200)), summary: Type.Optional(string(2000)),
  goal: Type.Optional(goal), content: Type.Optional(Type.String()),
  coverMediaId: Type.Optional(Type.Union([string(100),Type.Null()])),
}, {additionalProperties:false});
function request(context: Context) {
  const r = createRunContext.read(context);
  return { userId: r.userId, sessionId: r.sessionId, projectId: r.projectId, recordId: r.recordId, recordVersion: r.recordVersion, signal: context.abortSignal };
}
function result(details: unknown) { return { content: [{ type: "text" as const, text: JSON.stringify(details) }], details }; }
const quiet = { visible: false } as const;
const active = { visible: true, start: { displayContent: "正在创作…", animation: "working" as const },
  succeeded: { displayContent: "创作完成" }, failed: { displayContent: "这次创作未完成" } } as const;
export function createProjectReadTool(client: AgentBusinessServices): FantoTool<typeof projectRead, unknown> {
  return {name:"project_read",label:"读取脉络",presentation:quiet,
    description:"search 查询相关项目，get 根据 projectId（可省略，默认当前 Project）读取最新 goal/content/version/关联记录。",
    parameters:projectRead,executionMode:"parallel",replay:"safe",
    async execute(_id,input,_u,_t,_i,context) {if(!client.readProject)throw Error("CREATIVE_DISABLED"); return result(await client.readProject(request(context),input));} };
}
export function createProposalCreateTool(client: AgentBusinessServices): FantoTool<typeof proposal, unknown> {
  return {name:"proposal_create",label:"保存提议",presentation:quiet,
    description:"保存待确认提议。type=create 时提供 proposedSummary 和 content.ideas（每项包含新 goal）；type=extend 时必须提供 targetProjectId 与 content.change（kind/title/idea/tags/instruction），不提供 proposedSummary、不创建新 goal。",
    parameters:proposal,executionMode:"sequential",replay:"never",
    async execute(_id,input,_u,_t,_i,context) {if(!client.createProposal)throw Error("CREATIVE_DISABLED"); return result(await client.createProposal(request(context),input as import("../../domain/projects/index.js").CreateProposalInput));} };
}
export function createImageGenerateTool(client: AgentBusinessServices): FantoTool<typeof image, unknown> {
  return {name:"image_generate",label:"创作图片",presentation:active,
    description:"独立调用生图模型，输入多张参考图及 prompt，只生成一张图片并返回 mediaId/mimeType/width/height。不管理图片数量或预算。",
    parameters:image,executionMode:"sequential",replay:"never",
    async execute(_id,input,_u,_t,_i,context) {if(!client.generateImage)throw Error("CREATIVE_DISABLED"); return result(await client.generateImage(request(context),input));} };
}
export function createImageReviewTool(client: AgentBusinessServices): FantoTool<typeof review, unknown> {
  return { name: "image_review", label: "检查作品图片",
    presentation: { visible: true, start: {displayContent:"正在检查画面", animation:"working"}, succeeded:{displayContent:"画面检查完成"}, failed:{displayContent:"画面检查不可用"} },
    description: "实际检查生成图片。可选提供最多4张真实参考图 referenceMediaIds，视觉模型将比较主体身份、构图、光线与瑕疵；缺少参考图时不得声称已校验身份一致性。",
    parameters: review, executionMode: "sequential", replay: "safe",
    async execute(_id, input, _u, _t, _i, context) { if (!client.reviewImage) throw Error("CREATIVE_DISABLED"); return result(await client.reviewImage(request(context), input)); }
  };
}
export function createProjectManageTool(client: AgentBusinessServices): FantoTool<typeof manage, unknown> {
  return {name:"project_manage",label:"保存创作",presentation:{visible:true,start:{displayContent:"正在保存作品",animation:"working"},succeeded:{displayContent:"作品已更新"},failed:{displayContent:"作品保存失败"}},
    description:"保存最新 goal/content/标题/摘要/封面。content 必须是完整正文，新增生成图片需要先 image_review，否则拒绝保存。服务器复制外部媒体并规范引用。expectedVersion 从 project_read 获得。",
    parameters:manage,executionMode:"sequential",replay:"never",
    async execute(_id,input,_u,_t,_i,context) {if(!client.manageProject)throw Error("CREATIVE_DISABLED"); return result(await client.manageProject(request(context),input as import("../../domain/projects/creative-model.js").ProjectManageInput));} };
}
