import { z } from "zod";
import {
  mediaMetadataSchema,
  preferenceCreateSchema,
  preferenceDeleteSchema,
  preferenceListSchema,
  preferenceSchema,
  recordListSchema,
  recordSchema,
  recordSearchSchema,
  type FantoMediaMetadata,
  type FantoPreference,
  type FantoPreferenceCategory,
  type FantoPreferenceList,
  type FantoRecord,
  type FantoRecordList,
  type FantoRecordSearch,
} from "./schemas.js";

export type {
  FantoMediaMetadata,
  FantoPreference,
  FantoPreferenceCategory,
  FantoPreferenceList,
  FantoRecord,
  FantoRecordList,
  FantoRecordSearch,
} from "./schemas.js";

export type FantoRequestContext = {
  userId: string;
  traceId?: string;
  signal?: AbortSignal;
};

export class FantoServerClientError extends Error {
  constructor(
    message: string,
    readonly kind: "http" | "network" | "timeout" | "protocol",
    readonly status?: number,
    readonly errorCode?: string,
  ) {
    super(message);
    this.name = "FantoServerClientError";
  }
}

type FetchLike = typeof fetch;
type ErrorEnvelope = { success?: unknown; errorCode?: unknown; errorMsg?: unknown };

export class FantoServerClient {
  private readonly baseUrl: URL;

  constructor(
    baseUrl: string,
    private readonly timeoutMs = 15_000,
    private readonly fetchImpl: FetchLike = fetch,
  ) {
    let parsed: URL;
    try {
      parsed = new URL(baseUrl);
    } catch {
      throw new Error("FANTO_SERVER_BASE_URL must be a valid URL");
    }
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("FANTO_SERVER_BASE_URL must use http or https");
    this.baseUrl = parsed;
  }

  getRecord(ctx: FantoRequestContext, recordId: string): Promise<FantoRecord> {
    return this.request("GET", `/api/records/${encodeURIComponent(recordId)}`, ctx, recordSchema);
  }

  listRecords(ctx: FantoRequestContext, input: { limit: number; cursor?: string }): Promise<FantoRecordList> {
    const query = new URLSearchParams({ limit: String(input.limit) });
    if (input.cursor) query.set("cursor", input.cursor);
    return this.request("GET", `/api/records?${query}`, ctx, recordListSchema);
  }

  searchRecords(ctx: FantoRequestContext, input: { query: string; limit: number }): Promise<FantoRecordSearch> {
    return this.request("POST", "/api/records/search", ctx, recordSearchSchema, input);
  }



  listPreferences(ctx: FantoRequestContext): Promise<FantoPreferenceList> {
    return this.request("GET", "/api/preferences", ctx, preferenceListSchema);
  }

  createPreference(ctx: FantoRequestContext, input: {
    category: FantoPreferenceCategory;
    content: string;
    source: { sessionId: string; messageId: string; quote: string };
  }): Promise<{ preference: FantoPreference; reused: boolean }> {
    return this.request("POST", "/api/preferences", ctx, preferenceCreateSchema, input);
  }

  updatePreference(ctx: FantoRequestContext, preferenceId: string, input: {
    expectedVersion: number;
    category: FantoPreferenceCategory;
    content: string;
    source: { sessionId: string; messageId: string; quote: string };
  }): Promise<FantoPreference> {
    return this.request("PATCH", `/api/preferences/${encodeURIComponent(preferenceId)}`, ctx, preferenceSchema, input);
  }

  deletePreference(ctx: FantoRequestContext, preferenceId: string, expectedVersion: number): Promise<{ preferenceId: string }> {
    return this.request("DELETE", `/api/preferences/${encodeURIComponent(preferenceId)}`, ctx, preferenceDeleteSchema, { expectedVersion });
  }

  getMediaMetadata(ctx: FantoRequestContext, mediaId: string): Promise<FantoMediaMetadata> {
    return this.request("GET", `/api/media/${encodeURIComponent(mediaId)}/meta`, ctx, mediaMetadataSchema);
  }

  private async request<T>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    ctx: FantoRequestContext,
    resultSchema: z.ZodType<T>,
    body?: unknown,
  ): Promise<T> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const signal = ctx.signal ? AbortSignal.any([ctx.signal, timeout]) : timeout;
    const headers = new Headers({ "x-user-id": ctx.userId });
    if (ctx.traceId) headers.set("x-trace-id", ctx.traceId);
    if (body !== undefined) headers.set("content-type", "application/json");

    let response: Response;
    try {
      response = await this.fetchImpl(new URL(path, this.baseUrl), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });
    } catch (cause) {
      if (ctx.signal?.aborted) {
        if (ctx.signal.reason instanceof Error) throw ctx.signal.reason;
        throw new DOMException("The operation was aborted", "AbortError");
      }
      if (timeout.aborted) throw new FantoServerClientError("Fanto Server request timed out", "timeout");
      throw new FantoServerClientError("Fanto Server is temporarily unavailable", "network");
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new FantoServerClientError("Invalid response from Fanto Server", "protocol", response.status);
    }

    if (!response.ok) {
      const envelope = payload && typeof payload === "object" ? payload as ErrorEnvelope : {};
      const errorCode = typeof envelope.errorCode === "string" ? envelope.errorCode : undefined;
      const message = response.status === 404
        ? "Resource not found or not accessible"
        : typeof envelope.errorMsg === "string" && envelope.errorMsg.trim()
          ? envelope.errorMsg
          : `Fanto Server request failed with status ${response.status}`;
      throw new FantoServerClientError(message, "http", response.status, errorCode);
    }

    if (!payload || typeof payload !== "object") {
      throw new FantoServerClientError("Invalid response from Fanto Server", "protocol", response.status);
    }
    const envelope = payload as { success?: unknown; result?: unknown; errorCode?: unknown; errorMsg?: unknown };
    if (envelope.success !== true) {
      const errorCode = typeof envelope.errorCode === "string" ? envelope.errorCode : undefined;
      const message = typeof envelope.errorMsg === "string" && envelope.errorMsg.trim()
        ? envelope.errorMsg
        : "Fanto Server request failed";
      throw new FantoServerClientError(message, "http", response.status, errorCode);
    }

    const parsed = resultSchema.safeParse(envelope.result);
    if (!parsed.success) throw new FantoServerClientError("Invalid response from Fanto Server", "protocol", response.status);
    return parsed.data;
  }
}
