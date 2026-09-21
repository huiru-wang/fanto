import { Type } from "typebox";
import type { AgentHarnessTool, Context, ExecutionToolContext } from "@earendil-works/pi-agent-core";
import type { FantoMediaMetadata, FantoServerClient } from "../fanto/client.js";
import { requireRunMetadata } from "../agent/run-context.js";

const presentMediaSchema = Type.Object({
  mediaIds: Type.Array(
    Type.String({ minLength: 1, description: "其他记录能力实际返回的媒体标识。" }),
    { minItems: 1, maxItems: 20, description: "想展示的媒体，按希望呈现的顺序排列。" },
  ),
}, { additionalProperties: false });

export type PresentedMedia = FantoMediaMetadata;
export type PresentMediaDetails = { items: PresentedMedia[] };

function requestContext(context: Context) {
  const metadata = requireRunMetadata(context);
  return {
    userId: metadata.userId,
    traceId: metadata.traceId,
    signal: context.abortSignal,
  };
}

export function sanitizePresentMediaDetails(value: unknown): PresentMediaDetails | undefined {
  if (!value || typeof value !== "object") return undefined;
  const items = (value as { items?: unknown }).items;
  if (!Array.isArray(items)) return undefined;

  const sanitized: PresentedMedia[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") return undefined;
    const media = item as Record<string, unknown>;
    if (typeof media.mediaId !== "string" || (media.mediaType !== "image" && media.mediaType !== "audio") || typeof media.mimeType !== "string") {
      return undefined;
    }
    const output: PresentedMedia = {
      mediaId: media.mediaId,
      mediaType: media.mediaType,
      mimeType: media.mimeType,
    };
    for (const key of ["width", "height", "durationMs"] as const) {
      const field = media[key];
      if (field === undefined) continue;
      if (!Number.isInteger(field) || Number(field) <= 0) return undefined;
      output[key] = Number(field);
    }
    sanitized.push(output);
  }
  return { items: sanitized };
}

export function createPresentMediaTool(
  client: Pick<FantoServerClient, "getMediaMetadata">,
): AgentHarnessTool<ExecutionToolContext, typeof presentMediaSchema, PresentMediaDetails> {
  return {
    name: "present_media",
    label: "展示相关媒体",
    description: "当图片或音频能让当前回答更具体、更有感受，或本身就是用户正在谈论的事时使用；可以主动展示，不必等待用户点播。只有高度相关且不突兀、不重复时才使用。只能展示其他记录能力实际返回的媒体。",
    parameters: presentMediaSchema,
    executionMode: "parallel",
    replay: "safe",
    async execute(_toolCallId, params, _onUpdate, _toolContext, _invocation, context) {
      const mediaIds = [...new Set(params.mediaIds.map(mediaId => mediaId.trim()).filter(Boolean))];
      if (mediaIds.length === 0) throw new Error("present_media requires at least one mediaId");
      const ctx = requestContext(context);
      const items = await Promise.all(mediaIds.map(mediaId => client.getMediaMetadata(ctx, mediaId)));
      return {
        content: [{ type: "text" as const, text: `${items.length} media item${items.length === 1 ? "" : "s"} prepared.` }],
        details: { items },
      };
    },
  };
}
