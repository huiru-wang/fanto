import { useEffect, useRef, useState } from "react";
import { LockKeyhole, KeyRound, ShieldCheck } from "lucide-react";
import { adminApi } from "../api/admin";
import { useAuth } from "../auth/AuthContext";

type GoogleCredential = { credential: string };
type GoogleAccounts = { initialize: (options: { client_id: string; nonce: string; callback: (credential: GoogleCredential) => void }) => void; renderButton: (el: HTMLElement, options: object) => void };
declare global { interface Window { google?: { accounts: { id: GoogleAccounts } } } }

export function LoginPage() {
  const { login } = useAuth();
  const [pasted, setPasted] = useState("");
  const [tokenKind, setTokenKind] = useState<"access" | "refresh">("access");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const googleEl = useRef<HTMLDivElement>(null);
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
  const validate = async (token: string) => { await adminApi.users(token, new URLSearchParams({ limit: "1" })); login(token); };

  useEffect(() => {
    if (!clientId || !googleEl.current) return;
    let cancelled = false;
    let script: HTMLScriptElement | undefined;
    const setup = async () => {
      try {
        const intentResponse = await fetch("/api/auth/intents", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ purpose: "login", provider: "google" }) });
        const intent = await intentResponse.json() as { success: boolean; result?: { intentId: string; challenge: { nonce: string } } };
        if (!intentResponse.ok || !intent.success || !intent.result) throw new Error("无法创建 Google 登录请求");
        if (cancelled) return;
        const { intentId, challenge } = intent.result;
        script = document.createElement("script");
        script.src = "https://accounts.google.com/gsi/client";
        script.async = true;
        script.onload = () => {
          if (cancelled || !googleEl.current || !window.google) return;
          window.google.accounts.id.initialize({ client_id: clientId, nonce: challenge.nonce, callback: async result => {
            setBusy(true); setError("");
            try {
              const res = await fetch("/api/auth/logins", { method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ intentId, proof: { idToken: result.credential } }) });
              const body = await res.json() as { success?: boolean; result?: { accessToken: string }; errorMsg?: string };
              if (!res.ok || !body.success || !body.result) throw new Error(body.errorMsg ?? "Google 登录失败");
              await validate(body.result.accessToken);
            } catch (cause) { setError(cause instanceof Error ? cause.message : "Google 登录失败"); }
            finally { setBusy(false); }
          } });
          window.google.accounts.id.renderButton(googleEl.current, { type: "standard", theme: "outline", size: "large", text: "signin_with", width: 300 });
        };
        document.head.append(script);
      } catch (cause) { if (!cancelled) setError(cause instanceof Error ? cause.message : "初始化失败"); }
    };
    void setup();
    return () => { cancelled = true; script?.remove(); };
  }, [clientId]);
  const submitToken = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      let access = pasted.trim();
      if (tokenKind === "refresh") {
        const response = await fetch("/api/auth/tokens/refresh", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken: access }) });
        const body = await response.json().catch(() => null) as { success?: boolean; result?: { accessToken: string }; errorMsg?: string } | null;
        if (!response.ok || !body?.success || !body.result) throw new Error(body?.errorMsg ?? "Refresh Token 无效");
        access = body.result.accessToken;
      }
      await validate(access); setPasted("");
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : "认证失败"); }
    finally { setBusy(false); }
  };
  return <div className="login-shell"><div className="login-card">
    <div className="logo-mark"><LockKeyhole size={23}/></div>
    <div className="eyebrow">FANTO / INTERNAL</div><h1>管理后台</h1>
    <p className="muted">仅授权管理员可读取用户和会话统计。</p>
    {clientId ? <div className="google-area" ref={googleEl}/> : null}
    <form onSubmit={submitToken} className="login-form">
      <label htmlFor="access-token"><KeyRound size={15}/> Fanto 身份凭据</label>
      <div className="token-type"><button type="button" className={tokenKind === "access" ? "selected" : ""} onClick={() => setTokenKind("access")}>Access Token</button><button type="button" className={tokenKind === "refresh" ? "selected" : ""} onClick={() => setTokenKind("refresh")}>Refresh Token</button></div>
      <textarea id="access-token" value={pasted} onChange={e => setPasted(e.target.value)} placeholder={tokenKind === "access" ? "粘贴 user001 的 Access JWT" : "粘贴 user001 的 Refresh Token，服务端换取临时 Access JWT"} rows={3} spellCheck={false}/>
      <button type="submit" disabled={busy || !pasted.trim()}>{busy ? "验证中…" : "验证并进入"}</button>
    </form>
    {error && <div className="error" role="alert">{error}</div>}
    <p className="login-hint"><ShieldCheck size={15}/> Token 仅保存在页面内存，不会写入浏览器存储。</p>
  </div></div>;
}
