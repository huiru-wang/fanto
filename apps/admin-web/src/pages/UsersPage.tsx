import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Search, Users, RefreshCcw } from "lucide-react";
import { adminApi, type Page, type UserSummary } from "../api/admin";
import { useAuth } from "../auth/AuthContext";
import { formatDate, formatNumber } from "../components/UsageStats";

export function UsersPage() {
  const { adminKey } = useAuth();
  const [query, setQuery] = useState(""); const [committed, setCommitted] = useState("");
  const [status, setStatus] = useState(""); const [cursor, setCursor] = useState<string | null>(null);
  const [history, setHistory] = useState<(string | null)[]>([]);
  const [page, setPage] = useState<Page<UserSummary> | null>(null);
  const [loading, setLoading] = useState(false); const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!adminKey) return;
    const controller = new AbortController(); // guards late updates from earlier pages
    setLoading(true); setError("");
    const params = new URLSearchParams({ limit: "20" });
    if (committed) params.set("query", committed);
    if (status) params.set("status", status);
    if (cursor) params.set("cursor", cursor);
    void adminApi.users(adminKey, params).then(result => { if (!controller.signal.aborted) setPage(result); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "加载失败"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [adminKey, committed, status, cursor, refresh]);
  const newFilter = (search: string, selectedStatus: string) => { setCommitted(search); setStatus(selectedStatus); setCursor(null); setHistory([]); };
  return <div className="page">
    <div className="eyebrow">MANAGEMENT / USERS</div>
    <div className="heading-row"><div><h1>用户管理</h1><p>查看已注册用户、会话数量和累计 Token 消耗</p></div><button className="outline-button" onClick={() => setRefresh(x => x+1)}><RefreshCcw size={15}/> 刷新</button></div>
    <section className="panel"><div className="panel-header"><div><h2><Users size={19}/> 已注册用户</h2><span>按注册时间降序排列</span></div></div>
      <div className="filters"><form onSubmit={e => { e.preventDefault(); newFilter(query.trim(), status); }} className="search-form"><Search size={17}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索昵称或 User ID"/><button type="submit">搜索</button></form>
        <select value={status} onChange={e => newFilter(query.trim(), e.target.value)} aria-label="状态筛选"><option value="">全部状态</option><option value="active">正常</option><option value="disabled">已禁用</option></select></div>
      {error && <div className="error">{error}</div>}
      <div className="table-wrapper"><table className="data-table"><thead><tr><th>用户</th><th>状态</th><th>登录方式</th><th>会话</th><th>Total Tokens</th><th>注册时间</th><th></th></tr></thead>
        <tbody>{!loading && page?.data.length === 0 && <tr><td colSpan={7} className="empty">暂无匹配用户</td></tr>}
          {page?.data.map(user => <tr key={user.userId}><td><Link to={`/users/${encodeURIComponent(user.userId)}`} className="user-cell"><span className="user-avatar">{user.nickname.charAt(0).toUpperCase()}</span><span><strong>{user.nickname}</strong><small>{user.userId}</small></span></Link></td>
            <td><span className={`status-badge ${user.status}`}>{user.status === "active" ? "正常" : "禁用"}</span></td>
            <td>{user.providers.join(", ") || "—"}</td><td>{formatNumber(user.sessionCount)}</td><td className="numeric">{formatNumber(user.usage.totalTokens)}</td><td>{formatDate(user.createdAt)}</td>
            <td><Link to={`/users/${encodeURIComponent(user.userId)}`} aria-label="详情"><ChevronRight size={16}/></Link></td></tr>)}
        </tbody></table></div>
      <div className="pagination"><span>{loading ? "正在加载…" : `本页 ${page?.data.length ?? 0} 位用户`}</span><div><button disabled={loading || history.length === 0} onClick={() => { setCursor(history.at(-1)!); setHistory(arr => arr.slice(0,-1)); }}>上一页</button>
        <button disabled={loading || !page?.hasMore || !page.nextCursor} onClick={() => { setHistory(arr => [...arr,cursor]); setCursor(page!.nextCursor); }}>下一页</button></div></div>
    </section>
  </div>;
}
