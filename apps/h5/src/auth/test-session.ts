import { H5_TEST_AUTH_ENABLED, H5_TEST_REFRESH_TOKEN } from "../config";

type TokenPair = {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
};

type AuthEnvelope = {
  success?: boolean;
  result?: TokenPair;
  errorMsg?: string;
};

const storageKey = "fanto.h5.test-auth.tokens";
let tokens: TokenPair | null = null;
let refreshInFlight: Promise<TokenPair> | null = null;

function validTokenPair(value: unknown): value is TokenPair {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<TokenPair>;
  return typeof item.accessToken === "string"
    && typeof item.accessTokenExpiresAt === "string"
    && typeof item.refreshToken === "string"
    && typeof item.refreshTokenExpiresAt === "string";
}

function readStoredTokens(): TokenPair | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(storageKey) ?? "null") as unknown;
    return validTokenPair(value) ? value : null;
  } catch {
    return null;
  }
}

function storeTokens(value: TokenPair): TokenPair {
  tokens = value;
  sessionStorage.setItem(storageKey, JSON.stringify(value));
  return value;
}

function initialRefreshToken(): string {
  return tokens?.refreshToken || readStoredTokens()?.refreshToken || H5_TEST_REFRESH_TOKEN;
}

async function refreshWith(refreshToken: string): Promise<TokenPair> {
  if (!refreshToken) throw new Error("测试 refresh token 未配置");
  const response = await fetch("/api/auth/tokens/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  const payload = await response.json().catch(() => null) as AuthEnvelope | null;
  if (!response.ok || !payload?.success || !validTokenPair(payload.result)) {
    throw new Error(payload?.errorMsg ?? "测试会话失效");
  }
  return storeTokens(payload.result);
}

export async function initializeTestSession(): Promise<void> {
  if (!H5_TEST_AUTH_ENABLED) throw new Error("线上 H5 测试认证未启用");
  tokens ??= readStoredTokens();
  await refreshTestSession();
}

export async function refreshTestSession(): Promise<TokenPair> {
  if (!H5_TEST_AUTH_ENABLED) throw new Error("线上 H5 测试认证未启用");
  if (!refreshInFlight) {
    refreshInFlight = refreshWith(initialRefreshToken()).finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

export async function authorizedFetch(path: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  if (!tokens) await initializeTestSession();

  const request = () => {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${tokens!.accessToken}`);
    return fetch(path, { ...init, headers });
  };

  let response = await request();
  if (response.status !== 401) return response;

  await refreshTestSession();
  response = await request();
  return response;
}
