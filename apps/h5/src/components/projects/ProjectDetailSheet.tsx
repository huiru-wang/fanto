import { Archive, ArrowLeft, Check, ChevronDown, ChevronUp, CircleAlert, Clock3, RefreshCw, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { archiveProject, acceptProposal, getProject, getProjectCreation, getProposal, listProposalRecords, rejectProposal, type Creation, type ProjectDetail, type Proposal } from "../../api/projects";
import type { RecordItem } from "../../api/records";
import { RecordMediaList } from "../RecordMedia";
import { ProjectDocument } from "./ProjectHtmlPreview";

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

function facet(content: Proposal["content"], name: "保留" | "转化"): string | null {
  const constraint = content.creation?.constraints?.find(item => ["：", ":", "｜", "|"].some(separator => item.startsWith(name + separator)));
  return constraint?.slice(name.length + 1).trim() || null;
}

function ProposalSheet({ id, onAccepted, onRejected }: { id: string; onAccepted: (id: string) => void; onRejected: () => void }) {
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState(false);
  const [userInput, setUserInput] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [referencesLoading, setReferencesLoading] = useState(false);
  const [referencesError, setReferencesError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setProposal(await getProposal(id));
      setError(null);
    } catch (cause) {
      setError(messageOf(cause, "提议暂时无法加载"));
    } finally {
      setLoading(false);
    }
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
    } catch (cause) {
      setReferencesError(messageOf(cause, "参考记录加载失败"));
    } finally {
      setReferencesLoading(false);
    }
  };

  const toggleReferences = () => {
    if (!expanded && records.length === 0) void loadReferences();
    setExpanded(value => !value);
  };

  const decide = async (accept: boolean) => {
    if (!proposal || deciding || proposal.status !== "pending") return;
    setDeciding(true);
    setActionError(null);
    try {
      if (accept) {
        const result = await acceptProposal(id, proposal.content.creation ? userInput.trim() || undefined : undefined);
        onAccepted(result.resultProjectId);
      } else {
        await rejectProposal(id);
        onRejected();
      }
    } catch (cause) {
      setActionError(messageOf(cause, "操作没有完成，请稍后重试"));
      void load();
    } finally {
      setDeciding(false);
    }
  };

  if (loading && !proposal) return <div className="project-sheet-state"><span className="large-loader" /><p>正在打开提议…</p></div>;
  if (!proposal) return <div className="project-sheet-state"><CircleAlert size={22} /><p>{error}</p><button className="secondary-button" onClick={() => void load()}>重新加载</button></div>;

  const preserve = facet(proposal.content, "保留");
  const transform = facet(proposal.content, "转化");

  return (
    <>
      <div className="project-sheet-scroll">
        <div className="project-sheet-kicker"><Sparkles size={15} />{proposal.type === "extend" ? "继续创作" : "新的创作提议"}</div>
        <h2 className="project-sheet-title">{proposal.title}</h2>
        {!!proposal.content.tags?.length && <div className="project-tags proposal-sheet-tags">{proposal.content.tags.map(tag => <span key={tag}>{tag}</span>)}</div>}

        <section className="project-effect">
          <h3>创作效果</h3>
          <p>{proposal.content.idea}</p>
          {(preserve || transform) && <div className="project-effect-facets">
            {preserve && <div><span>保留</span><p>{preserve}</p></div>}
            {transform && <div><span>转化</span><p>{transform}</p></div>}
          </div>}
        </section>

        {!!proposal.content.plan?.length && <section className="project-detail-section">
          <h3>创作计划</h3>
          <div className="project-plan">{proposal.content.plan.map((step, index) => {
            const separator = step.indexOf("｜");
            const title = separator < 0 ? step : step.slice(0, separator).trim();
            const description = separator < 0 ? null : step.slice(separator + 1).trim();
            return <div className="project-plan-step" key={index}>
              <span className="project-plan-number">{String(index + 1).padStart(2, "0")}</span>
              <div><strong>{title}</strong>{description && <p>{description}</p>}</div>
            </div>;
          })}</div>
        </section>}

        {proposal.status === "pending" && proposal.content.creation && <section className="project-detail-section">
          <h3>想再改一点？</h3>
          <p className="project-muted">告诉 Fanto 你更希望作品是什么样子。</p>
          <textarea className="project-suggestion-input" maxLength={500} rows={3} placeholder="比如：不要文字，色调更温暖一点…" value={userInput} onChange={event => setUserInput(event.target.value)} aria-label="补充创作想法" />
          {userInput.length > 0 && <span className="project-character-count">{userInput.length}/500</span>}
        </section>}

        <section className="project-detail-section project-reference-section">
          <button className="project-reference-toggle" type="button" onClick={toggleReferences} aria-expanded={expanded}>
            <span><Clock3 size={17} />参考记录{proposal.referenceRecordCount ? ` · ${proposal.referenceRecordCount}` : ""}</span>
            {expanded ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
          </button>
          {expanded && <RecordReferences records={records} count={proposal.referenceRecordCount ?? records.length} cursor={cursor} loading={referencesLoading} error={referencesError} onMore={() => void loadReferences(true)} onRetry={() => void loadReferences(false)} />}
        </section>
        {error && <p className="project-form-error" role="alert">{error} <button type="button" onClick={() => void load()}>重新加载</button></p>}
      </div>

      <div className="project-sheet-bottom">
        {actionError && <p role="alert" className="project-form-error">{actionError}</p>}
        {proposal.status === "pending" ? <div className="project-sheet-actions">
          <button type="button" className="project-decline" disabled={deciding} onClick={() => void decide(false)}>不感兴趣</button>
          <button type="button" className="project-accept" disabled={deciding} onClick={() => void decide(true)}>{deciding ? "正在处理…" : "创作试试"} <ArrowLeft size={15} className="project-arrow-forward" /></button>
        </div> : <span className="project-muted">{proposal.status === "accepted" ? "已接受这份提议" : "已略过这份提议"}</span>}
      </div>
    </>
  );
}

const progressText = (creation: Creation) => {
  if (creation.status === "failed") return "创作暂时中断，可以稍后查看";
  if (creation.status === "cancelled") return "创作已取消";
  if (creation.status === "queued") return "灵感已收好，正在等待创作";
  if (creation.progress.stage === "generating") {
    const count = creation.progress.completedImages ?? 0;
    return `正在绘制画面${creation.progress.imageCount ? ` · ${count}/${creation.progress.imageCount}` : ""}`;
  }
  if (creation.progress.stage === "writing") return "正在整理成作品";
  return "正在创作中…";
};

function ProjectSheet({ id, onArchived }: { id: string; onArchived: () => void }) {
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [creation, setCreation] = useState<Creation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);
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
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    const poll = async () => {
      try {
        const result = await getProjectCreation(id);
        if (cancelled) return;
        setCreation(result.creation);
        if (result.creation?.status === "completed") {
          await load();
          return;
        }
        if (result.creation && !["queued", "running"].includes(result.creation.status)) return;
        if (++attempts < 150) timer = setTimeout(() => void poll(), 4000);
      } catch {
        // Some installations don't enable the optional Creative Runtime.
      }
    };
    void poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [id, load]);

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
        {creation && creation.status !== "completed" && <div className={`project-creation-status ${creation.status === "failed" ? "is-failed" : ""}`}>
          {["queued", "running"].includes(creation.status) ? <span className="project-pulse" /> : <CircleAlert size={17} />}
          <span>{progressText(creation)}</span>
        </div>}
        {project.content?.trim() ? <ProjectDocument content={project.content} title={project.title} /> : <div className="project-unpublished">
          <p>{project.summary}</p>
          <span>{creation && ["queued", "running"].includes(creation.status) ? "作品还在准备中，完成后将自动更新。" : "作品正文暂未发布"}</span>
        </div>}

        <section className="project-detail-section project-reference-section">
          <button className="project-reference-toggle" type="button" onClick={() => setShowRecords(value => !value)} aria-expanded={showRecords}>
            <span><Clock3 size={17} />参考记录 · {project.recordCount}</span>
            {showRecords ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
          </button>
          {showRecords && <RecordReferences records={project.referenceRecords} count={project.recordCount} cursor={null} />}
        </section>

        {error && <div className="project-form-error" role="alert">{error} <button type="button" onClick={() => void load()}>重新加载</button></div>}
      </div>
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
