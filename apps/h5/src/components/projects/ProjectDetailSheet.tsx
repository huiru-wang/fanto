import { Archive, ArrowLeft, Check, ChevronDown, ChevronUp, CircleAlert, Clock3, RefreshCw, Sparkles, X, MessageCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { archiveProject, acceptProposal, getProject, getProposal, listProposalRecords, rejectProposal, startProjectSession, type ProjectDetail, type Proposal } from "../../api/projects";
import type { RecordItem } from "../../api/records";
import { RecordMediaList } from "../RecordMedia";
import { ProjectDocument } from "./ProjectHtmlPreview";
import { ProjectSessionChat } from "./ProjectSessionChat";

type SheetProps = {
  proposalId: string | null;
  projectId: string | null;
  onClose: () => void;
  onAccepted: (id: string) => void;
  onRejected: () => void;
  onArchived: () => void;
};

function messageOf(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric" }).format(new Date(value));
}

function RecordReferences({ records, count, cursor, loading, error, onMore, onRetry }: {
  records: RecordItem[];
  count: number;
  cursor: string | null;
  loading?: boolean;
  error?: string | null;
  onMore?: () => void;
  onRetry?: () => void;
}) {
  return (
    <div className="project-references-list">
      {records.map(record => (
        <div className="project-record" key={record.id}>
          <span className="project-record-node" />
          <div className="project-record-body">
            <time>{formatDate(record.eventAt)}</time>
            {record.content.text && <p>{record.content.text}</p>}
            {record.content.blocks?.length > 0 && <RecordMediaList blocks={record.content.blocks} />}
          </div>
        </div>
      ))}
      {!loading && records.length === 0 && !error && <p className="project-muted">相关记录可能已被删除。</p>}
      {error && <p className="project-form-error" role="alert">{error} {onRetry && <button onClick={onRetry} type="button">重试</button>}</p>}
      {loading && <p className="project-muted">正在读取参考记录…</p>}
      {cursor && onMore && <button type="button" disabled={loading} className="project-load-more" onClick={onMore}>查看更多记录</button>}
      {!cursor && count > records.length && !onMore && <p className="project-muted">展示最近 {records.length} 条记录</p>}
    </div>
  );
}

function ProposalSheet({ id, onAccepted, onRejected }: { id: string; onAccepted: (id: string) => void; onRejected: () => void }) {
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [referencesLoading, setReferencesLoading] = useState(false);
  const [referencesError, setReferencesError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await getProposal(id);
      setProposal(next);
      setSelected(current => next.status === "accepted" ? next.content.selectedIdeaId : next.content.ideas.length === 1 ? next.content.ideas[0]!.id : next.content.ideas.some(idea => idea.id === current) ? current : null);
      setError(null);
    } catch (cause) { setError(messageOf(cause, "提议暂时无法加载")); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const loadReferences = async (append = false) => {
    if (referencesLoading) return;
    setReferencesLoading(true);
    setReferencesError(null);
    try {
      const page = await listProposalRecords(id, append ? cursor : null);
      setRecords(current => {
        const seen = new Set<string>();
        return [...(append ? current : []), ...page.data].filter(item => !seen.has(item.id) && !!seen.add(item.id));
      });
      setCursor(page.hasMore ? page.nextCursor : null);
    } catch (cause) { setReferencesError(messageOf(cause, "参考记录加载失败")); }
    finally { setReferencesLoading(false); }
  };
  const toggleReferences = () => {
    if (!expanded && records.length === 0) void loadReferences();
    setExpanded(value => !value);
  };
  const decide = async (accept: boolean) => {
    if (!proposal || deciding || (proposal.status !== "pending" && !(accept && proposal.status === "accepted"))) return;
    if (accept && !selected) return;
    setDeciding(true);
    setActionError(null);
    try {
      if (accept) {
        const result = await acceptProposal(id, proposal.content.selectedIdeaId ?? selected!);
        onAccepted(result.resultProjectId);
      } else {
        await rejectProposal(id);
        onRejected();
      }
    } catch (cause) {
      setActionError(messageOf(cause, "操作没有完成，请重试"));
      await load();
    } finally { setDeciding(false); }
  };

  if (loading && !proposal) return <div className="project-sheet-state"><span className="large-loader" /><p>正在打开提议…</p></div>;
  if (!proposal) return <div className="project-sheet-state"><CircleAlert size={22} /><p>{error}</p><button className="secondary-button" onClick={() => void load()}>重新加载</button></div>;

  return <>
    <div className="project-sheet-scroll">
      <div className="project-sheet-kicker"><Sparkles size={15} />{proposal.type === "extend" ? "继续创作" : "新的创作提议"}</div>
      <h2 className="project-sheet-title">{proposal.title}</h2>
      <div className="proposal-choices" role="group" aria-label="选择创意方向">
        {proposal.content.ideas.map(idea => {
          const checked = (proposal.status === "accepted" ? proposal.content.selectedIdeaId : selected) === idea.id;
          return <button key={idea.id} type="button" aria-pressed={checked}
            className={`proposal-option${checked ? " selected" : ""}`}
            disabled={deciding || proposal.status !== "pending"}
            onClick={() => setSelected(idea.id)}>
            <span className="proposal-option-head"><strong>{idea.title}</strong><span aria-hidden="true" className="proposal-option-check">{checked ? <Check size={15} /> : null}</span></span>
            <span className="proposal-option-idea">{idea.idea}</span>
            <span className="project-tags">{idea.tags.map(tag => <span key={tag}>{tag}</span>)}</span>
          </button>;
        })}
      </div>
      <section className="project-detail-section project-reference-section">
        <button className="project-reference-toggle" type="button" onClick={toggleReferences} aria-expanded={expanded}>
          <span><Clock3 size={17} />参考记录{proposal.referenceRecordCount ? ` · ${proposal.referenceRecordCount}` : ""}</span>
          {expanded ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
        </button>
        {expanded && <RecordReferences records={records} count={proposal.referenceRecordCount ?? records.length} cursor={cursor} loading={referencesLoading} error={referencesError} onMore={() => void loadReferences(true)} onRetry={() => void loadReferences(false)} />}
      </section>
      {error && <p className="project-form-error" role="alert">{error} <button onClick={() => void load()}>重新加载</button></p>}
    </div>
    <div className="project-sheet-bottom">
      {actionError && <p role="alert" className="project-form-error">{actionError}</p>}
      {proposal.status === "pending" ? <div className="project-sheet-actions">
        <button type="button" className="project-decline" disabled={deciding} onClick={() => void decide(false)}>不感兴趣</button>
        <button type="button" className="project-accept" disabled={deciding || !selected} onClick={() => void decide(true)}>{deciding ? "正在提交…" : "按这个方向创作"} <ArrowLeft size={15} className="project-arrow-forward" /></button>
      </div> : proposal.status === "accepted" ? <div className="project-sheet-actions">
        <span className="project-muted">已确认上方所选方向</span>
        <button type="button" className="project-accept" disabled={deciding} onClick={() => void decide(true)}>{deciding ? "正在启动…" : "进入作品 / 重试启动"}</button>
      </div> : <span className="project-muted">已略过这份提议</span>}
    </div>
  </>;
}

function ProjectSheet({ id, onArchived }: { id: string; onArchived: () => void }) {
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [showChat, setShowChat] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [showRecords, setShowRecords] = useState(false);

  const load = useCallback(async () => {
    try {
      setProject(await getProject(id));
      setError(null);
    } catch (cause) {
      setError(messageOf(cause, "无法读取作品"));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const timer = setInterval(() => void getProject(id).then(next => setProject(current =>
      !current || current.version !== next.version ? next : current)).catch(() => {}), 3000);
    return () => clearInterval(timer);
  }, [id]);

  const start = async () => {
    setStarting(true);
    setError(null);
    try { await startProjectSession(id); await load(); }
    catch (cause) { setError(messageOf(cause, "会话尚未准备好，可重试")); }
    finally { setStarting(false); }
  };

  const archive = async () => {
    if (!project || archiving || !window.confirm("归档后仍可查看作品，但不能再修改或扩展。确定归档吗？")) return;
    setArchiving(true);
    setError(null);
    try {
      await archiveProject(id, project.version);
      onArchived();
    } catch (cause) {
      setError(messageOf(cause, "归档失败，请刷新重试"));
      await load();
    } finally {
      setArchiving(false);
    }
  };

  if (loading && !project) return <div className="project-sheet-state"><span className="large-loader" /><p>正在打开作品…</p></div>;
  if (!project) return <div className="project-sheet-state"><CircleAlert size={22} /><p>{error}</p><button className="secondary-button" onClick={() => void load()}>重新加载</button></div>;

  return (
    <>
      <div className="project-sheet-scroll">
        <div className="project-sheet-kicker"><Check size={15} />{project.status === "archived" ? "已归档的作品" : "创作成果"}<span>·</span><time>{formatDate(project.updatedAt)}</time></div>
        <h2 className="project-sheet-title">{project.title}</h2>
        {project.content?.trim()
          ? <ProjectDocument content={project.content} title={project.title} />
          : <div className="project-unpublished"><p>{project.summary}</p><span>创作过程会在下方实时呈现</span></div>}
        {!project.content?.trim() && project.sessionId && <ProjectSessionChat projectId={project.projectId} sessionId={project.sessionId} onUpdated={() => void load()} />}
        {!project.sessionId && project.status === "active" && <button type="button" className="project-accept" disabled={starting} onClick={() => void start()}>{starting ? "正在启动…" : "开始创作"}</button>}

        <section className="project-detail-section project-reference-section">
          <button className="project-reference-toggle" type="button" onClick={() => setShowRecords(value => !value)} aria-expanded={showRecords}>
            <span><Clock3 size={17} />参考记录 · {project.recordCount}</span>
            {showRecords ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
          </button>
          {showRecords && <RecordReferences records={project.referenceRecords} count={project.recordCount} cursor={null} />}
        </section>

        {error && <div className="project-form-error" role="alert">{error} <button type="button" onClick={() => void load()}>重新加载</button></div>}
      </div>
      {project.content?.trim() && project.sessionId && project.status === "active" && <div className="project-session-float">
        {showChat && <div className="project-session-popover"><ProjectSessionChat projectId={project.projectId} sessionId={project.sessionId} onUpdated={() => void load()} /></div>}
        <button type="button" className="project-session-launch" onClick={() => setShowChat(!showChat)}><MessageCircle size={19}/>{showChat ? "收起对话" : "继续创作"}</button>
      </div>}
      <div className="project-sheet-bottom project-sheet-footer">
        <span className="project-muted">{project.status === "archived" ? "作品已归档" : "作品会随着新的创作继续生长"}</span>
        {project.status === "active" && <button className="project-archive-button" type="button" onClick={() => void archive()} disabled={archiving}><Archive size={16} />{archiving ? "归档中…" : "归档"}</button>}
      </div>
    </>
  );
}

export function ProjectDetailSheet({ proposalId, projectId, onClose, onAccepted, onRejected, onArchived }: SheetProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
      if (event.key !== "Tab" || !dialogRef.current) return;
      const controls = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled)')];
      if (!controls.length) return;
      const first = controls[0]!;
      const last = controls[controls.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", handleKey);
    };
  }, []);

  return (
    <div className="project-sheet-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="project-sheet" role="dialog" aria-modal="true" aria-label={proposalId ? "创作提议详情" : "作品详情"} ref={dialogRef}>
        <div className="project-sheet-toolbar">
          <button type="button" className="project-back-button" onClick={onClose}><ArrowLeft size={19} />返回脉络</button>
          <button type="button" className="project-close-button" onClick={onClose} aria-label="关闭" ref={closeRef}><X size={19} /></button>
        </div>
        {proposalId ? <ProposalSheet id={proposalId} onAccepted={onAccepted} onRejected={onRejected} /> : projectId ? <ProjectSheet id={projectId} onArchived={onArchived} /> : null}
      </div>
    </div>
  );
}
