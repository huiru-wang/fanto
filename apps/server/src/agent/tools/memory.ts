import { Type } from "typebox";
import type { Context } from "@earendil-works/pi-agent-core";
import type { AgentBusinessServices, AgentMemory, AgentMemorySearch } from "../business-services.js";
import { createRunContext } from "../context/index.js";
import type { FantoTool } from "./types.js";

const memoryKind = Type.Union([
  Type.Literal("personal_background"),
  Type.Literal("important_relationships"),
  Type.Literal("current_focus"),
  Type.Literal("interaction_preferences"),
]);

const schema = Type.Object({
  action: Type.Union([Type.Literal("list"), Type.Literal("search"), Type.Literal("create"), Type.Literal("update"), Type.Literal("delete")]),
  memoryId: Type.Optional(Type.String({ minLength: 1, description: "要修改或删除的记忆 ID。" })),
  kind: Type.Optional(memoryKind),
  content: Type.Optional(Type.String({ minLength: 1, maxLength: 1000, description: "一个可独立理解的简洁事实或主题；update 须包含更新后的完整正文，保留兼容信息及必要日期。" })),
  query: Type.Optional(Type.String({ minLength: 1, maxLength: 1000, description: "按当前对话的对象和话题描述要回想的信息，例如小宝与用户的关系、求职面试进展。" })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 10, description: "search 最多返回多少条，默认 5。" })),
}, { additionalProperties: false });

type MemoryDetails =
  | { action: "list"; memories: AgentMemory[] }
  | { action: "search"; memories: AgentMemorySearch[] }
  | { action: "create" | "update"; memory: AgentMemory }
  | { action: "delete"; memoryId: string };

type MemoryClient = Pick<AgentBusinessServices, "listMemories" | "searchMemories" | "createMemory" | "updateMemory" | "deleteMemory">;

function requestContext(context: Context) {
  const run = createRunContext.read(context);
  return {
    userId: run.userId,
    traceId: run.traceId,
    signal: context.abortSignal,
    sessionId: run.sessionId,
    sourceMessageId: run.sourceMessageId,
    timeZone: run.timeZone,
  };
}

function result(details: MemoryDetails) {
  return { content: [{ type: "text" as const, text: JSON.stringify(details) }], details };
}

function requireString(value: string | undefined, name: string): string {
  if (!value?.trim()) throw new Error(`memory_manage action requires ${name}`);
  return value.trim();
}

function assertAllowed(params: Record<string, unknown>, allowed: readonly string[]) {
  for (const [key, value] of Object.entries(params)) {
    if (key !== "action" && value !== undefined && !allowed.includes(key)) throw new Error(`memory_manage action does not accept ${key}`);
  }
}

export function createMemoryManageTool(client: MemoryClient): FantoTool<typeof schema, MemoryDetails> {
  return {
    name: "memory_manage",
    label: "管理长期记忆",
    presentation: { visible: false },
    description: "管理对话长期记忆。personal_background（个人背景）和 interaction_preferences（相处偏好）默认提供；important_relationships（重要关系）、current_focus（近期关注）按话题 search。已有上下文足够时不重复检索。明确、持续有用的用户自述应本轮保存，不必等用户说记住；写入边界遵循核心记忆规则。创建前确认无重复；关系/关注未在上下文中时先 search，修改前用已知 memoryId 或 search 定位原条目；补充、纠错、递进、完成用 update 完整替换同一条，重复不操作，歧义不覆盖。list 用于查看记忆，可选 kind；search 必填 query，可选 limit；create 必填 kind/content；update 必填 memoryId/kind/content；delete 仅用户明确要求忘记时使用，必填 memoryId。只传对应 action 所需字段，成功后才能声称已保存；本轮变更以工具成功返回内容为准，不再引用旧值。",
    parameters: schema,
    executionMode: "sequential",
    replay: "never",
    async execute(_toolCallId, params, _onUpdate, _toolContext, _invocation, context) {
      switch (params.action) {
        case "list": {
          assertAllowed(params, ["kind"]);
          return result({ action: "list", memories: await client.listMemories(requestContext(context), { kind: params.kind }) });
        }
        case "search": {
          assertAllowed(params, ["query", "limit"]);
          return result({ action: "search", memories: await client.searchMemories(requestContext(context), { query: requireString(params.query, "query"), limit: params.limit ?? 5 }) });
        }
        case "create": {
          assertAllowed(params, ["kind", "content"]);
          if (!params.kind) throw new Error("memory_manage action requires kind");
          return result({ action: "create", memory: await client.createMemory(requestContext(context), { kind: params.kind, content: requireString(params.content, "content") }) });
        }
        case "update": {
          assertAllowed(params, ["memoryId", "kind", "content"]);
          if (!params.kind) throw new Error("memory_manage action requires kind");
          return result({ action: "update", memory: await client.updateMemory(requestContext(context), requireString(params.memoryId, "memoryId"), { kind: params.kind, content: requireString(params.content, "content") }) });
        }
        case "delete": {
          assertAllowed(params, ["memoryId"]);
          const memoryId = requireString(params.memoryId, "memoryId");
          await client.deleteMemory(requestContext(context), memoryId);
          return result({ action: "delete", memoryId });
        }
      }
    },
  };
}
