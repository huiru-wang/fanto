import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ChevronDown, ChevronUp, MessageSquareText } from "lucide-react";
import { adminApi, type Page, type Session, type SessionUsage, type User, type UserUsage } from "../api/admin";
import { useAuth } from "../auth/AuthContext";
import { UsageStats, formatNumber, formatCost, formatDate } from "../components/UsageStats";
function SessionItem({ session, adminKey }: { session: Session; adminKey: string }) {
  const [open, setOpen] = useState(false); const [detail, setDetail] = useState<SessionUsage | null>(null); const [error, setError] = useState("");
  useEffect(() => {
    if (!open || detail) return;
    let alive = true;
    void adminApi.sessionUsage(adminKey, session.sessionId).then(result => { if (alive) setDetail(result); }).catch(cause => { if (alive) setError(String(cause)); });
    return () => { alive = false; };
  }, [open, detail, adminKey, session.sessionId]);
  return <div className="session-item"><button className="session-trigger" onClick={() => setOpen(x => !x)} aria-expanded={open}>
    <span className="session-type"><MessageSquareText size={19}/></span>
    <span className="session-main"><strong>{session.title || "未命名会话"}</strong><small>{session.agentId} · {session.sessionId}</small></span>
    <span className="session-date">{formatDate(session.updatedAt)}</span>
    <span className="session-tokens"><strong>{formatNumber(session.usage.totalTokens)}</strong><small>tokens</small></span>
    {open ? <ChevronUp size={17}/> : <ChevronDown size={17}/>}
  </button>{open && <div className="session-expanded"><UsageStats usage={session.usage}/>
    <h3>Model 用量</h3>{error && <div className="error">{error}</div>}
    {detail ? detail.models.length ? <div className="model-table"><table className="data-table"><thead><tr><th>Provider / Model</th><th>Input</th><th>Output</th><th>Tokens</th><th>Cost</th></tr></thead><tbody>
      {detail.models.map((m,i) => <tr key={`${m.provider}:${m.model}:${i}`}><td>{m.provider} / {m.model}</td><td>{formatNumber(m.usage.input)}</td><td>{formatNumber(m.usage.output)}</td><td>{formatNumber(m.usage.totalTokens)}</td><td>{formatCost(m.usage.estimatedCost)}</td></tr>)}</tbody></table></div>
      : <p className="muted">没有已持久化的模型用量记录。</p> : <p className="muted">加载模型分组中…</p>}
  </div>}</div>;
}
export function UserDetailPage() {
  const { userId = "" } = useParams(); const { adminKey } = useAuth();
  const [user, setUser] = useState<User | null>(null); const [usage, setUsage] = useState<UserUsage | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]); const [cursor, setCursor] = useState<string | null>(null);
  const [more, setMore] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  useEffect(() => {
    if (!adminKey) return;
    let alive = true;
    setUser(null); setUsage(null); setSessions([]); setCursor(null); setMore(false); setError("");
    void Promise.all([adminApi.user(adminKey,userId), adminApi.userUsage(adminKey,userId), adminApi.sessions(adminKey,userId,new URLSearchParams({limit:"20"}))])
      .then(([nextUser,nextUsage,page]) => { if (!alive) return; setUser(nextUser); setUsage(nextUsage); setSessions(page.data); setCursor(page.nextCursor); setMore(page.hasMore); })
      .catch(cause => { if (alive) setError(cause instanceof Error ? cause.message : "加载失败"); });
    return () => { alive = false; };
  }, [adminKey, userId]);
  const nextPage = async () => {
    if (!adminKey || !cursor || busy) return;
    setBusy(true); setError("");
    try { const page: Page<Session> = await adminApi.sessions(adminKey,userId,new URLSearchParams({limit:"20",cursor}));
      setSessions(old => [...old,...page.data]); setCursor(page.nextCursor); setMore(page.hasMore); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "加载失败"); }
    finally { setBusy(false); }
  };
  return <div className="page"><Link to="/users" className="back-link"><ArrowLeft size={16}/> 返回用户列表</Link>
    {error && <div className="error">{error}</div>}
    {!user ? <p className="muted">正在加载用户资料…</p> : <>
      <div className="profile-card"><span className="profile-avatar">{user.nickname.charAt(0).toUpperCase()}</span><div><div className="eyebrow">USER PROFILE</div><h1>{user.nickname} <span className={`status-badge ${user.status}`}>{user.status === "active" ? "正常" : "禁用"}</span></h1>
        <div className="profile-meta"><span>ID: {user.userId}</span><span>登录方式: {user.providers.join(", ") || "—"}</span><span>注册: {formatDate(user.createdAt)}</span><span>最近登录: {formatDate(user.lastLoginAt)}</span></div></div></div>
      <section className="panel"><div className="panel-header"><div><h2>用户累计 Token</h2><span>全部 Agent Session 已持久化的模型用量</span></div></div>
        {usage ? <UsageStats usage={usage.usage} sessionCount={usage.sessionCount}/> : <p className="muted panel-padding">加载中…</p>}</section>
      <section className="panel"><div className="panel-header"><div><h2>会话记录</h2><span>查看用户的对话会话</span></div><span className="count-pill">{sessions.length} 条已加载</span></div>
        {sessions.length ? sessions.map(s => <SessionItem key={s.sessionId} session={s} adminKey={adminKey!}/>) : <div className="empty">暂无会话记录</div>}
        {more && <div className="load-more"><button disabled={busy} onClick={() => void nextPage()}>{busy ? "加载中…" : "加载更多会话"}</button></div>}
      </section></>}
  </div>;
}
