import { Type } from "typebox";
import type { Context } from "@earendil-works/pi-agent-core";
import type { AgentBusinessServices, AgentMemory, AgentMemorySearch } from "../business-services.js";
import { createRunContext } from "../context/index.js";
import type { FantoTool } from "./types.js";

const memoryKind = Type.Union([
  Type.Literal("profile"),
  Type.Literal("goal"),
  Type.Literal("guidance"),
]);

const schema = Type.Object({
  action: Type.Union([Type.Literal("list"), Type.Literal("search"), Type.Literal("create"), Type.Literal("update"), Type.Literal("delete")]),
  memoryId: Type.Optional(Type.String({ minLength: 1, description: "要修改或删除的记忆 ID。" })),
  kind: Type.Optional(memoryKind),
  content: Type.Optional(Type.String({ minLength: 1, maxLength: 1000, description: "要保存的简洁、可独立理解的记忆正文。" })),
  query: Type.Optional(Type.String({ minLength: 1, maxLength: 1000, description: "用自然语言描述需要回想的用户背景、长期目标或历史偏好。" })),
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
    task: run.task,
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
    description: "管理 Fanto 的长期记忆。kind: guidance 是用户希望助手长期遵循的沟通或协作方式，会自动出现在每轮上下文；profile 是稳定背景、身份或长期习惯；goal 是仍有意义的长期目标、承诺或进行中事项。只有用户明确要求记住、修改或忘记时才 create/update/delete。当前问题确实需要背景、目标或习惯且上下文中没有时，用 search；用户要求查看已存记忆时用 list。每种 action 只传其需要的字段：list 可选 kind；search 需要 query，可选 limit；create 需要 kind 和 content；update 需要 memoryId、kind 和 content；delete 需要 memoryId。",
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
