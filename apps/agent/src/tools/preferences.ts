import { Type } from "typebox";
import type { AgentHarnessTool, Context, ExecutionToolContext } from "@earendil-works/pi-agent-core";
import type { FantoPreference, FantoServerClient } from "../fanto/client.js";
import { requireRunMetadata } from "../agent/run-context.js";

type PreferenceClient = Pick<FantoServerClient, "listPreferences" | "createPreference" | "updatePreference" | "deletePreference">;

const category = Type.Union([Type.Literal("communication"), Type.Literal("scenario"), Type.Literal("lifestyle")]);
const sourceQuote = Type.String({ minLength: 1, maxLength: 1000, description: "当前用户消息中，明确支持这次偏好变更的一段连续原话。" });
// Keep the tool schema as a single object. Some OpenAI-compatible providers
// reject TypeBox unions (anyOf) when converting tools to function schemas.
const schema = Type.Object({
  action: Type.Union([Type.Literal("create"), Type.Literal("update"), Type.Literal("delete")]),
  category: Type.Optional(category),
  content: Type.Optional(Type.String({ minLength: 1, maxLength: 2000 })),
  preferenceId: Type.Optional(Type.String({ minLength: 1 })),
  expectedVersion: Type.Optional(Type.Integer({ minimum: 1 })),
  sourceQuote,
}, { additionalProperties: false });

type PreferenceDetails = {
  action: "create" | "update" | "delete";
  changedPreferenceId: string;
  preferences: Array<Pick<FantoPreference, "preferenceId" | "category" | "content" | "version">>;
};

function source(context: Context, quote: string) {
  const metadata = requireRunMetadata(context);
  if (!metadata.sessionId || !metadata.sourceMessageId || !metadata.currentMessage) {
    throw new Error("Preference change is missing current user message provenance");
  }
  const normalized = quote.trim();
  if (!normalized || !metadata.currentMessage.includes(normalized)) {
    throw new Error("sourceQuote must be a continuous exact quote from the current user message");
  }
  return {
    request: { userId: metadata.userId, traceId: metadata.traceId, signal: context.abortSignal },
    source: { sessionId: metadata.sessionId, messageId: metadata.sourceMessageId, quote: normalized },
  };
}

const asResult = (details: PreferenceDetails) => ({
  content: [{ type: "text" as const, text: JSON.stringify(details) }],
  details,
});

export function createPreferenceManageTool(client: PreferenceClient): AgentHarnessTool<ExecutionToolContext, typeof schema, PreferenceDetails> {
  return {
    name: "preference_manage",
    label: "管理长期偏好",
    description: "仅当用户明确表达希望长期延续的偏好，或明确要求修改、删除偏好时使用。不要保存临时要求、推测出的特质、记录内容、角色扮演或第三方的话。sourceQuote 必须逐字来自当前用户消息。",
    parameters: schema,
    executionMode: "sequential",
    replay: "never",
    async execute(_toolCallId, params, _onUpdate, _toolContext, _invocation, context) {
      const provenance = source(context, params.sourceQuote);
      let changedPreferenceId: string;
      if (params.action === "create") {
        if (!params.category || !params.content) {
          throw new Error("create preference requires category and content");
        }
        const result = await client.createPreference(provenance.request, {
          category: params.category, content: params.content.trim(), source: provenance.source,
        });
        changedPreferenceId = result.preference.preferenceId;
      } else if (params.action === "update") {
        if (!params.preferenceId || !params.expectedVersion || !params.category || !params.content) {
          throw new Error("update preference requires preferenceId, expectedVersion, category and content");
        }
        const result = await client.updatePreference(provenance.request, params.preferenceId, {
          expectedVersion: params.expectedVersion, category: params.category, content: params.content.trim(), source: provenance.source,
        });
        changedPreferenceId = result.preferenceId;
      } else {
        if (!params.preferenceId || !params.expectedVersion) {
          throw new Error("delete preference requires preferenceId and expectedVersion");
        }
        const result = await client.deletePreference(provenance.request, params.preferenceId, params.expectedVersion);
        changedPreferenceId = result.preferenceId;
      }
      const current = await client.listPreferences(provenance.request);
      return asResult({
        action: params.action,
        changedPreferenceId,
        preferences: current.data.map(({ preferenceId, category, content, version }) => ({ preferenceId, category, content, version })),
      });
    },
  };
}
