import { useEffect, useState } from "react";
export function StartupExperience({ state, message, onRetry, onBack }: { state: "restoring" | "preparing" | "error" | "loggingOut"; message?: string; onRetry?: () => void; onBack?: () => void }) {
  const [showStatus, setShowStatus] = useState(false);
  useEffect(() => { setShowStatus(false); const id = setTimeout(() => setShowStatus(true), 1000); return () => clearTimeout(id); }, [state]);
  return <main className="auth-page"><div className="auth-center">
    <img className="auth-startup-sprite" src="/assets/fanto/auth/startup.webp" alt="Fanto" />
    <h1>一个懂你的世界，从这里开始</h1>
    {state === "error" ? <div className="auth-status" role="alert"><p>{message || "暂时无法连接"}</p>
      <button onClick={onRetry}>重试</button>{onBack && <button onClick={onBack}>返回登录</button>}</div> :
      <p className="auth-status" aria-live="polite">{showStatus ? state === "loggingOut" ? "正在退出登录…" : state === "preparing" ? "正在准备你的 Fanto…" : "正在恢复登录…" : ""}</p>}
  </div></main>;
}
