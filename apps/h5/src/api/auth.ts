import { requestJson } from "./http";
export type AuthUser = { userId: string; status: string };
export type WebIntent = { intentId: string; expiresAt: string; challenge: { nonce: string } };
export const restoreUser = () => requestJson<AuthUser>("/api/users/me");
export const webIntent = () => requestJson<WebIntent>("/api/auth/web/intents", { method: "POST", body: JSON.stringify({ purpose: "authenticate", provider: "google" }) });
export const webAuthenticate = (intentId: string, idToken: string) => requestJson<{ user: AuthUser }>("/api/auth/web/authentications", { method: "POST", body: JSON.stringify({ intentId, proof: { idToken } }) });
export async function webLogout() {
  const response = await fetch("/api/auth/web/logout", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-Fanto-Web": "1" }, body: "{}" });
  if (!response.ok) throw new Error("退出失败，请检查网络后重试");
}
