import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { restoreUser, webLogout, type AuthUser } from "../api/auth";
import { ApiError } from "../api/http";

type AuthState = { status: "restoring" | "signedOut" | "ready" | "error" | "loggingOut" | "logoutError"; user: AuthUser | null; error: string;
  retry: () => Promise<void>; login: (user: AuthUser) => void; logout: () => Promise<void> };
const Context = createContext<AuthState | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthState["status"]>("restoring");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [error, setError] = useState("");
  const retry = useCallback(async () => {
    setStatus("restoring"); setError("");
    try { const me = await restoreUser(); setUser(me); setStatus("ready"); }
    catch (cause) {
      if (cause instanceof ApiError && (cause.status === 401 || cause.code === "USER_DISABLED")) { setUser(null); setStatus("signedOut"); }
      else { setStatus("error"); setError("暂时无法连接，请重试。"); }
    }
  }, []);
  useEffect(() => { void retry(); }, [retry]);
  useEffect(() => {
    const invalidated = () => { setUser(null); setStatus("signedOut"); };
    window.addEventListener("fanto:auth-invalidated", invalidated);
    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("fanto-auth") : null;
    if (channel) channel.onmessage = event => { if (event.data === "signed-out") invalidated(); };
    return () => { window.removeEventListener("fanto:auth-invalidated", invalidated); channel?.close(); };
  }, []);
  const login = useCallback((value: AuthUser) => { setUser(value); setError(""); setStatus("ready"); }, []);
  const logout = useCallback(async () => {
    setStatus("loggingOut"); setError("");
    try {
      await webLogout();
      setUser(null); setStatus("signedOut");
      sessionStorage.removeItem("fanto.h5.test-auth.tokens");
      if (typeof BroadcastChannel !== "undefined") { const channel = new BroadcastChannel("fanto-auth"); channel.postMessage("signed-out"); channel.close(); }
      // All business subscriptions are unmounted after signedOut, including active SSE.
    } catch (cause) { setError(cause instanceof Error ? cause.message : "退出失败"); setStatus("logoutError"); }
  }, []);
  return <Context.Provider value={{ status, user, error, retry, login, logout }}>{children}</Context.Provider>;
}
export function useAuth() { const value = useContext(Context); if (!value) throw new Error("Missing AuthProvider"); return value; }
