import { useEffect, useRef, useState } from "react";
import { webAuthenticate, webIntent } from "../api/auth";
import { useAuth } from "./AuthProvider";

type CredentialResponse = { credential?: string };
type GoogleAccounts = { id: { initialize: (options: Record<string, unknown>) => void;
  renderButton: (element: HTMLElement, options: Record<string, unknown>) => void; cancel: () => void } };
declare global { interface Window { google?: { accounts: GoogleAccounts } } }
let sdkPromise: Promise<void> | null = null;
function loadSdk() {
  return sdkPromise ??= new Promise<void>((resolve, reject) => {
    if (window.google?.accounts) return resolve();
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client"; script.async = true; script.defer = true;
    script.onload = () => resolve(); script.onerror = () => { sdkPromise = null; reject(new Error("无法加载 Google 登录服务")); };
    document.head.appendChild(script);
  });
}
export function GoogleSignInButton() {
  const auth = useAuth();
  const target = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const setup = async () => {
      setError("");
      try {
        const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim();
        if (!clientId) throw new Error("Google 登录尚未配置");
        const intent = await webIntent();
        await loadSdk();
        if (cancelled || !target.current || !window.google) return;
        const appleMobile = /iP(hone|ad|od)/.test(navigator.userAgent) ||
          (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
        const safariMobile = appleMobile && /Safari/.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent);
        window.google.accounts.id.initialize({ client_id: clientId, nonce: intent.challenge.nonce, auto_select: false,
          ux_mode: safariMobile ? "redirect" : "popup", login_uri: `${window.location.origin}/api/auth/web/redirect`,
          callback: async (response: CredentialResponse) => {
            if (!response.credential || cancelled) { setError("Google 未返回有效凭证"); return; }
            setBusy(true); setError("");
            try { const result = await webAuthenticate(intent.intentId, response.credential); if (!cancelled) auth.login(result.user); }
            catch (cause) { if (!cancelled) setError(cause instanceof Error ? cause.message : "登录失败，请重试"); }
            finally { if (!cancelled) { setBusy(false); setAttempt(value => value + 1); } }
          } });
        target.current.replaceChildren();
        window.google.accounts.id.renderButton(target.current, { type: "standard", theme: "outline", size: "large", text: "continue_with", width: 320, shape: "pill" });
      } catch (cause) { if (!cancelled) setError(cause instanceof Error ? cause.message : "登录服务不可用"); }
    };
    void setup();
    return () => { cancelled = true; };
  }, [attempt, auth.login]);
  return <div className="google-signin"><div ref={target} aria-label="使用 Google 账号登录" />
    {busy && <p role="status">正在登录…</p>}
    {error && <div role="alert" className="auth-error">{error} <button type="button" onClick={() => setAttempt(value => value + 1)}>重试</button></div>}
  </div>;
}
