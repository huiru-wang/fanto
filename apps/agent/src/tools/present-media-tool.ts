import { Type } from "typebox";
import type { AgentHarnessTool, Context, ExecutionToolContext } from "@earendil-works/pi-agent-core";
import type { FantoMediaMetadata, FantoServerClient } from "../clients/fanto-server-client.js";
import { requireRunMetadata } from "../harness/run-context.js";

const presentMediaSchema = Type.Object({
  mediaIds: Type.Array(
    Type.String({ minLength: 1, description: "Media ID returned by Fanto Record tools." }),
    { minItems: 1, maxItems: 20, description: "Media items to present in display order." },
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
    label: "Present Media",
    description: "Present image or audio media that was returned by Fanto Record tools. Only pass real media IDs from tool results. The system validates ownership and media type before presentation.",
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
