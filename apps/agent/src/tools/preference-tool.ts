import { Type } from "typebox";
import type { AgentHarnessTool, Context, ExecutionToolContext } from "@earendil-works/pi-agent-core";
import type { FantoPreference, FantoServerClient } from "../clients/fanto-server-client.js";
import { requireRunMetadata } from "../harness/run-context.js";

type PreferenceClient = Pick<FantoServerClient, "listPreferences" | "createPreference" | "updatePreference" | "deletePreference">;

const category = Type.Union([Type.Literal("communication"), Type.Literal("scenario"), Type.Literal("lifestyle")]);
const sourceQuote = Type.String({ minLength: 1, maxLength: 1000, description: "A continuous exact quote from the current user message that explicitly supports this preference change." });
const schema = Type.Union([
  Type.Object({
    action: Type.Literal("create"),
    category,
    content: Type.String({ minLength: 1, maxLength: 2000 }),
    sourceQuote,
  }, { additionalProperties: false }),
  Type.Object({
    action: Type.Literal("update"),
    preferenceId: Type.String({ minLength: 1 }),
    expectedVersion: Type.Integer({ minimum: 1 }),
    category,
    content: Type.String({ minLength: 1, maxLength: 2000 }),
    sourceQuote,
  }, { additionalProperties: false }),
  Type.Object({
    action: Type.Literal("delete"),
    preferenceId: Type.String({ minLength: 1 }),
    expectedVersion: Type.Integer({ minimum: 1 }),
    sourceQuote,
  }, { additionalProperties: false }),
]);

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
    label: "Manage User Preference",
    description: "Create, update, or delete a long-term user preference only when the current user explicitly expresses a durable preference or asks to manage one. Do not save temporary instructions, inferred traits, record content, role-play text, or third-party statements. sourceQuote must be copied exactly from the current user message.",
    parameters: schema,
    executionMode: "sequential",
    replay: "never",
    async execute(_toolCallId, params, _onUpdate, _toolContext, _invocation, context) {
      const provenance = source(context, params.sourceQuote);
      let changedPreferenceId: string;
      if (params.action === "create") {
        const result = await client.createPreference(provenance.request, {
          category: params.category, content: params.content.trim(), source: provenance.source,
        });
        changedPreferenceId = result.preference.preferenceId;
      } else if (params.action === "update") {
        const result = await client.updatePreference(provenance.request, params.preferenceId, {
          expectedVersion: params.expectedVersion, category: params.category, content: params.content.trim(), source: provenance.source,
        });
        changedPreferenceId = result.preferenceId;
      } else {
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
