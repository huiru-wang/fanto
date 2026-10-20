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
  Type.Literal("shared_history"),
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
    description: "检索与管理长期记忆。默认提供个人背景及互动偏好；重要关系、持续关注和 shared_history（共同约定与已确认的经历/剧情）按需查找。对未来持续有用的明确事实、进展和约定应保存，但不存未经确认的推断或即兴虚构；shared_history 须标记虚构剧情性质。create 前确认无重复，同一事项优先 update，用户要求遗忘才 delete。list 可选 kind；search 传 query/limit；create 传 kind/content；update 传 memoryId/kind/content；delete 传 memoryId。仅成功后才声称写入。",
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
