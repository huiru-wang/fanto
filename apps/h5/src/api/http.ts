import { FANTO_USER_ID } from "../config";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("X-User-Id", FANTO_USER_ID);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const response = await fetch(path, { ...init, headers });
  const payload = await response.json().catch(() => null) as {
    success?: boolean;
    result?: T;
    errorMsg?: string;
    error?: string;
  } | null;

  if (!response.ok || payload?.success === false) {
    throw new ApiError(payload?.errorMsg ?? payload?.error ?? `Request failed (${response.status})`, response.status);
  }
  if (payload && "result" in payload) return payload.result as T;
  return payload as T;
}
