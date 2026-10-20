import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Archive, ArrowRight, Plus, RotateCcw, Trash2 } from "lucide-react";
import { deleteFanto, getFanto, setFantoArchived, type FantoSettings } from "../api/fanto";
import { ApiError } from "../api/http";
import { useFanto, type PendingDeletion } from "./FantoContext";
import { FantoAvatar } from "./FantoAvatar";
import { fantoLabel } from "./settings-state";

export function FantoListPage() {
  const profile = useFanto(), navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null), [notice, setNotice] = useState("");
  const working = useRef(false);
  const active = profile.roles.filter(role => role.status === "active");
  const archived = profile.roles.filter(role => role.status === "archived");
  const openChat = (id: string | null) => { profile.select(id); navigate("/chat"); };
  const action = async (role: FantoSettings, kind: "archive" | "restore" | "delete") => {
    if (working.current) return;
    if (kind === "delete" && !window.confirm(`彻底删除「${fantoLabel(role)}」？角色对话、独立记忆和专属媒体将被删除，无法恢复。你的个人记录和其他角色会保留。`)) return;
    if (kind === "archive" && !window.confirm(`归档「${fantoLabel(role)}」？对话和记忆会保留，恢复后可继续。`)) return;
    working.current = true; setBusy(role.fantoId); setNotice("");
    try {
      if (kind === "delete") {
        const pending: PendingDeletion = { fantoId: role.fantoId, version: role.version, nickname: fantoLabel(role) };
        // Retain a retry target even if the response is lost after the role row disappears.
        profile.updatePending(pending);
        const result = await deleteFanto(role.fantoId, role.version);
        profile.forget(role.fantoId);
        profile.updatePending(pending, !result);
        setNotice(result ? "角色已删除，部分媒体仍在清理。可在下方重试。" : "角色及专属数据已删除。");
      } else {
        profile.accept(await setFantoArchived(role.fantoId, role.version, kind === "archive"));
        setNotice(kind === "archive" ? "角色已归档，对话和记忆已保留。" : "角色已恢复，可以继续原来的对话。");
      }
    } catch (cause) {
      const knownRefusal = cause instanceof ApiError && cause.status < 500;
      if (kind === "delete" && knownRefusal) profile.updatePending({ fantoId: role.fantoId, version: role.version, nickname: fantoLabel(role) }, true);
      if (cause instanceof ApiError && cause.code === "FANTO_BUSY") setNotice("角色正在回复，请在当前对话结束后重试。");
      else if (cause instanceof ApiError && cause.code === "FANTO_LIMIT_REACHED") setNotice("最多使用 3 个活跃角色，请先归档一个角色。");
      else setNotice(kind === "delete" && !knownRefusal ? "删除结果未确认，已保留清理入口。请刷新核对后重试。"
        : "操作未完成，已读取最新角色状态，请核对后重试。");
      try { profile.accept(await getFanto(role.fantoId)); }
      catch (error) { if (error instanceof ApiError && error.status === 404) profile.forget(role.fantoId); }
    } finally { working.current = false; setBusy(null); }
  };
  const retryDeletion = async (pending: PendingDeletion) => {
    if (working.current) return;
    working.current = true; setBusy(pending.fantoId); setNotice("");
    try {
      // If a prior request never reached the server, require the normal confirmation/version path again.
      let exists = false;
      try { profile.accept(await getFanto(pending.fantoId)); exists = true; }
      catch (cause) { if (!(cause instanceof ApiError && cause.status === 404)) throw cause; }
      if (exists) {
        profile.updatePending(pending, true); setNotice("角色仍存在，之前的删除未完成。请从角色卡片重新确认删除。"); return;
      }
      const result = await deleteFanto(pending.fantoId, pending.version);
      if (!result) { profile.updatePending(pending, true); profile.forget(pending.fantoId); }
      setNotice(result ? "媒体尚未清理完成，可稍后再次重试。" : "清理完成。");
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 404) { profile.updatePending(pending, true); setNotice("角色和待处理清理任务均不存在。"); }
      else setNotice("暂时无法确认清理结果，请稍后重试。");
    } finally { working.current = false; setBusy(null); }
  };
  return <section className="fanto-list-page">
    <header className="fanto-list-header"><div><p className="eyebrow">Your Fantos</p><h1>选择一起聊天的人</h1>
      <p>每个角色拥有自己的对话与记忆，最多同时使用 3 个角色。</p></div>
      <button className="secondary-button" disabled={profile.loading || !!busy} onClick={() => void profile.refresh()}><RotateCcw size={16} />刷新</button>
    </header>
    {(profile.error || notice) && <p role="status" className="fanto-notice">{notice || profile.error}</p>}
    <button className="fanto-main-card" onClick={() => openChat(null)} disabled={profile.loading || !profile.sessionId}>
      <FantoAvatar avatarMediaId={null} label="默认 Main" size={48} /><span><strong>默认 Main</strong><small>通用助理，可读取你的记录并管理个人记忆；不占角色名额。</small></span><ArrowRight size={20} />
    </button>
    <div className="fanto-section-heading"><h2>使用中 <small>{active.length} / 3</small></h2>
      <Link className={`secondary-button ${active.length >= 3 || profile.loading ? "is-disabled" : ""}`} aria-disabled={active.length >= 3 || profile.loading}
        tabIndex={active.length >= 3 || profile.loading ? -1 : undefined} to="/fantos/new"><Plus size={16} />创建角色</Link>
    </div>
    {profile.loading && !profile.roles.length ? <p role="status">正在读取角色…</p> : !active.length && <p className="fanto-empty">还没有使用中的角色。可以先与默认 Main 聊聊，或创建第一个角色。</p>}
    <div className="fanto-role-grid">{active.map(role => <RoleCard key={role.fantoId} role={role} busy={!!busy}
      onChat={() => openChat(role.fantoId)} onAction={kind => void action(role, kind)} />)}</div>
    {archived.length > 0 && <><div className="fanto-section-heading"><h2>已归档 <small>{archived.length}</small></h2><span>对话和记忆仍保留</span></div>
      <div className="fanto-role-grid">{archived.map(role => <RoleCard key={role.fantoId} role={role} busy={!!busy} restoreDisabled={active.length >= 3}
        onChat={() => {}} onAction={kind => void action(role, kind)} />)}</div></>}
    {profile.pendingDeletions.length > 0 && <section className="fanto-pending" aria-label="待确认的删除清理"><h2>删除与媒体清理</h2>
      {profile.pendingDeletions.map(item => <div key={item.fantoId}><span>{item.nickname} · 待确认清理</span>
        <button className="secondary-button" disabled={!!busy} onClick={() => void retryDeletion(item)}>检查并重试</button></div>)}
    </section>}
  </section>;
}
function RoleCard({ role, busy, restoreDisabled, onChat, onAction }: {
  role: FantoSettings;
  busy: boolean;
  restoreDisabled?: boolean;
  onChat: () => void;
  onAction: (action: "archive" | "restore" | "delete") => void;
}) {
  const archived = role.status === "archived";
  return <article className={`fanto-role-card ${archived ? "archived" : ""}`}>
    <div className="fanto-role-identity"><FantoAvatar size={56} avatarMediaId={role.avatarMediaId} label={fantoLabel(role)} />
      <div><h3>{fantoLabel(role)}</h3><p>{role.description || "还没有简介"}</p></div></div>
    <div className="fanto-role-tags"><span>独立角色记忆</span>{role.agentConfig.recordReadEnabled && <span>可读记录</span>}
      {role.agentConfig.userMemoryEnabled && <span>可读个人记忆</span>}{role.agentConfig.narrationEnabled && <span>动作旁白</span>}</div>
    <div className="fanto-role-actions">
      {!archived && <button className="provider-action" disabled={busy} onClick={onChat}>开始聊天</button>}
      <Link to={`/fantos/${role.fantoId}`} className="secondary-button">{archived ? "查看设定" : "角色配置"}</Link>
      <button className="icon-button" disabled={busy || (archived && restoreDisabled)} onClick={() => onAction(archived ? "restore" : "archive")}
        title={archived && restoreDisabled ? "最多 3 个活跃角色，请先归档一个" : archived ? "恢复角色" : "归档角色"} aria-label={archived ? "恢复角色" : "归档角色"}>
        {archived ? <RotateCcw size={18} /> : <Archive size={18} />}</button>
      <button className="icon-button fanto-delete" disabled={busy} aria-label="彻底删除角色" onClick={() => onAction("delete")}><Trash2 size={18} /></button>
    </div>
  </article>;
}
