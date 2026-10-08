import { Type } from "typebox";
import type { Context } from "@earendil-works/pi-agent-core";
import type { AgentBusinessServices } from "../business-services.js";
import { createRunContext } from "../context/index.js";
import type { FantoTool } from "./types.js";
const str = (max = 2000) => Type.String({ minLength: 1, maxLength: max });
const ids = (max = 3) => Type.Array(str(100), { minItems: 1, maxItems: max });
const creation = Type.Object({
  objective: Type.String({ minLength: 1, maxLength: 4000, description: "最终交付给用户什么，只描述主题与成果，不写工具或执行参数。" }),
  context: Type.Optional(Type.String({ minLength: 1, maxLength: 12000, description: "真实人物、场景、素材背景与创意依据；区分事实与拟议变化。" })),
  constraints: Type.Optional(Type.Array(str(1000), { maxItems: 20, description: "保留项、允许变化范围与明确禁止项。" })),
  successCriteria: Type.Optional(Type.Array(str(1000), { maxItems: 20, description: "从用户视角判断成果是否符合提议。" })),
}, { additionalProperties: false });
const proposalSchema = Type.Object({
  type: Type.Union([Type.Literal("create"), Type.Literal("extend")]),
  targetProjectId: Type.Optional(str(100)),
  title: Type.String({ minLength: 1, maxLength: 200, description: "有作品感和画面感的标题；优先表达场景与创意结果，避免“生成/制作/创作一个”等任务式命名。" }),
  proposedSummary: Type.Optional(Type.String({ minLength: 1, maxLength: 2000, description: "顶层项目摘要，create 必填，extend 省略；真实来源、主体、主题和延续边界。不得放入 content。" })),
  recordIds: ids(100),
  content: Type.Object({
    reason: Type.String({ minLength: 1, maxLength: 10000, description: "内部判断依据：为什么值得提议、为何选择该方向、历史记录为何关联；不作为主要 UI 文案。" }),
    idea: Type.String({ minLength: 1, maxLength: 1000, description: "面向用户的“创作效果”，最多 2 句话：先说最终作品，再说最重要的保留与转化；禁止技术执行步骤。" }),
    plan: Type.Array(Type.String({ minLength: 1, maxLength: 500, description: "格式：短标题｜一句结果说明。描述用户最终能看到的变化，不写 Agent 操作。" }), { minItems: 3, maxItems: 3 }),
    tags: Type.Array(Type.String({ minLength: 2, maxLength: 12, description: "作品化短标签，不是规格或执行约束。" }), { minItems: 2, maxItems: 4, uniqueItems: true }),
    creation,
  }, { additionalProperties: false }),
}, { additionalProperties: false });
// Tool providers require an object at the JSON Schema root; action rules are checked by the Service.
const projectSchema = Type.Object({ action: Type.Union([Type.Literal("search"), Type.Literal("get")]), projectId: Type.Optional(str(100)), query: Type.Optional(str()) }, { additionalProperties: false });
const prepareSchema = Type.Object({ sourceMediaIds: ids(), subjectMediaId: str(100), imageCount: Type.Integer({ minimum: 1, maximum: 3 }) }, { additionalProperties: false });
const imageSchema = Type.Object({ imageIndex: Type.Integer({ minimum: 1, maximum: 3 }), prompt: str(6000), referenceMediaIds: ids(), aspectRatio: Type.Optional(Type.Union([Type.Literal("portrait"), Type.Literal("landscape"), Type.Literal("square")])) }, { additionalProperties: false });
const publishSchema = Type.Object({ expectedVersion: Type.Integer({ minimum: 1 }), markdown: str(2 * 1024 * 1024), summary: str(), coverMediaId: Type.Optional(str(100)) }, { additionalProperties: false });
function request(context: Context) { const r = createRunContext.read(context); if (!r.creative) throw new Error("CREATIVE_AUTHORITY_REQUIRED"); return { userId: r.userId, sessionId: r.sessionId, creative: r.creative, signal: context.abortSignal }; }
const result = (details: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(details) }], details });
export function createProjectReadTool(client: AgentBusinessServices): FantoTool<typeof projectSchema, unknown> { return { name: "project_read", label: "读取项目", presentation: { visible: false }, description: "search 必填 query，按 summary 向量检索同用户 active 项目，固定返回最多 3 个候选；get 必填 projectId，读取详情及最近参考记录。相似度只是候选排序，须核实是否属于同一主题或经历。创作 Agent 只能读授权目标。contentPreview 是截断预览，禁止整段写回。", parameters: projectSchema, executionMode: "parallel", replay: "safe", async execute(_id, input, _u, _t, _i, context) { if (!client.readProject) throw new Error("CREATIVE_AGENT_DISABLED"); return result(await client.readProject(request(context), input)); } }; }
export function createProposalCreateTool(client: AgentBusinessServices): FantoTool<typeof proposalSchema, unknown> { return { name: "proposal_create", label: "保存提议", presentation: { visible: false }, description: "保存一条等待用户确认的创作 Proposal。create 必填 proposedSummary，extend 必填 targetProjectId。所有 recordIds 必须已完整读取并包含触发 Record；成功后停止。", parameters: proposalSchema, executionMode: "sequential", replay: "never", async execute(_id, input, _u, _t, _i, context) { if (!client.createProposal) throw new Error("CREATIVE_AGENT_DISABLED"); return result(await client.createProposal(request(context), input)); } }; }
export function createImageGenerateTool(client: AgentBusinessServices): FantoTool<typeof imageSchema, unknown> { return { name: "image_generate", label: "创作图片", presentation: { visible: false }, description: "在固定 imageIndex 生成并保存一张参考照片编辑图。至少包含 executionPlan.subject 原图，保持已确认保留项；返回的是已保存的 mediaId。重复同输入不会重复生图，失败不能换索引绕过数量预算。", parameters: imageSchema, executionMode: "sequential", replay: "never", async execute(_id, input, _u, _t, _i, context) { if (!client.generateImage) throw new Error("CREATIVE_AGENT_DISABLED"); return result(await client.generateImage(request(context), input)); } }; }
export function createCreationPublishTool(client: AgentBusinessServices): FantoTool<typeof publishSchema, unknown> { return { name: "creation_publish", label: "发布图文成果", presentation: { visible: false }, description: "全部图片保存后，使用最新 Project version 发布本次 Markdown 图文及整个项目的准确 summary。append 只传增量，服务器保留旧成果。版本冲突先读取最新版本，不重做图片。成功后停止。", parameters: publishSchema, executionMode: "sequential", replay: "never", async execute(_id, input, _u, _t, _i, context) { if (!client.publishCreation) throw new Error("CREATIVE_AGENT_DISABLED"); return result(await client.publishCreation(request(context), input)); } }; }

export function createCreationPrepareTool(client: AgentBusinessServices): FantoTool<typeof prepareSchema, unknown> {
  return { name: "creation_prepare", label: "确定创作素材", presentation: { visible: false }, description: "读取授权 Record 后确定原图、主体参考图与 1–3 张图片数量。必须符合已确认 creation 目标；首次保存后计划不可改变，重试复用原计划。生图和发布前必需。", parameters: prepareSchema, executionMode: "sequential", replay: "safe", async execute(_id, input, _u, _t, _i, context) { if (!client.prepareCreation) throw new Error("CREATIVE_AGENT_DISABLED"); return result(await client.prepareCreation(request(context), input)); } };
}
