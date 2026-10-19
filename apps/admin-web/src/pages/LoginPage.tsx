import { useState, type FormEvent } from "react";
import { KeyRound, LockKeyhole, ShieldCheck } from "lucide-react";
import { adminApi } from "../api/admin";
import { useAuth } from "../auth/AuthContext";

/** The secret is entered locally and sent only in the X-Admin-Key header. */
export function LoginPage() {
  const { login } = useAuth();
  const [inputKey, setInputKey] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const key = inputKey.trim();
      // Validate against an existing protected endpoint before allowing navigation.
      await adminApi.users(key, new URLSearchParams({ limit: "1" }));
      login(key);
      setInputKey("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "密钥验证失败");
    } finally {
      setBusy(false);
    }
  };
  return <div className="login-shell"><div className="login-card">
    <div className="logo-mark"><LockKeyhole size={23}/></div>
    <div className="eyebrow">FANTO / INTERNAL</div><h1>管理后台</h1>
    <p className="muted">输入 Server 环境变量 ADMIN_ACCESS_KEY 设置的密钥。</p>
    <form onSubmit={submit} className="login-form">
      <label htmlFor="admin-key"><KeyRound size={15}/> Admin 密钥</label>
      <input id="admin-key" type="password" autoComplete="off" value={inputKey}
        onChange={event => setInputKey(event.target.value)} placeholder="请输入管理密钥" spellCheck={false}/>
      <button type="submit" disabled={busy || !inputKey.trim()}>{busy ? "验证中…" : "验证并进入"}</button>
    </form>
    {error && <div className="error" role="alert">{error}</div>}
    <p className="login-hint"><ShieldCheck size={15}/> 密钥仅保存在当前页面内存，不会写入浏览器存储。</p>
  </div></div>;
}
