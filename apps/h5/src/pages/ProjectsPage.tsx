import { ArrowRight, Archive, BookOpenText, ChevronRight, RefreshCw, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { listProjects, listProposals, type Page, type Project, type ProjectStatus, type Proposal } from "../api/projects";
import { ProjectCover } from "../components/projects/ProjectCover";
import { ProjectDetailSheet } from "../components/projects/ProjectDetailSheet";

function dateText(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(new Date(value));
}

function appendUnique<T>(current: T[], incoming: T[], key: (item: T) => string): T[] {
  const existing = new Set(current.map(key));
  return [...current, ...incoming.filter(item => !existing.has(key(item)))];
}

export function ProjectsPage() {
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<ProjectStatus>("active");
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [proposalCursor, setProposalCursor] = useState<string | null>(null);
  const [projectCursor, setProjectCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState<"proposals" | "projects" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proposalError, setProposalError] = useState<string | null>(null);
  const [projectError, setProjectError] = useState<string | null>(null);
  const projectRequest = useRef(0);
  const selectedProposalId = params.get("proposalId");
  const selectedProjectId = selectedProposalId ? null : params.get("projectId");

  const loadProposals = useCallback(async () => {
    try {
      const result = await listProposals();
      setProposals(result.data);
      setProposalCursor(result.hasMore ? result.nextCursor : null);
      setProposalError(null);
    } catch (cause) {
      setProposalError(cause instanceof Error ? cause.message : "暂时无法读取创作提议");
    }
  }, []);

  const loadProjects = useCallback(async (status: ProjectStatus) => {
    const request = ++projectRequest.current;
    try {
      const result = await listProjects(status);
      if (request !== projectRequest.current) return;
      setProjects(result.data);
      setProjectCursor(result.hasMore ? result.nextCursor : null);
      setProjectError(null);
    } catch (cause) {
      if (request === projectRequest.current) setProjectError(cause instanceof Error ? cause.message : "暂时无法读取创作成果");
    }
  }, []);

  const refresh = useCallback(async (status: ProjectStatus) => {
    setLoading(true);
    setError(null);
    await Promise.all([loadProposals(), loadProjects(status)]);
    setLoading(false);
  }, [loadProjects, loadProposals]);

  useEffect(() => {
    setProjects([]);
    setProjectCursor(null);
    setProjectError(null);
    void refresh(tab);
  }, [refresh, tab]);

  const open = (kind: "projectId" | "proposalId", id: string) => {
    const next = new URLSearchParams();
    next.set(kind, id);
    setParams(next);
  };

  const close = () => setParams(new URLSearchParams(), { replace: true });

  const onAccepted = (projectId: string) => {
    void refresh(tab);
    open("projectId", projectId);
  };

  const onRejected = () => {
    void refresh(tab);
    close();
  };

  const loadMore = async (kind: "projects" | "proposals") => {
    if (loadingMore) return;
    const cursor = kind === "projects" ? projectCursor : proposalCursor;
    if (!cursor) return;
    setLoadingMore(kind);
    setError(null);
    try {
      if (kind === "projects") {
        const page: Page<Project> = await listProjects(tab, cursor);
        setProjects(current => appendUnique(current, page.data, item => item.projectId));
        setProjectCursor(page.hasMore ? page.nextCursor : null);
      } else {
        const page: Page<Proposal> = await listProposals(cursor);
        setProposals(current => appendUnique(current, page.data, item => item.proposalId));
        setProposalCursor(page.hasMore ? page.nextCursor : null);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "加载更多时遇到问题");
    } finally {
      setLoadingMore(null);
    }
  };

  return (
    <div className="page projects-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">让记录生长出新的可能</p>
          <h1>脉络</h1>
          <p className="page-description">值得珍藏的瞬间，还可以继续成为作品。</p>
        </div>
        <button type="button" className="icon-button" onClick={() => void refresh(tab)} disabled={loading} aria-label="刷新脉络" title="刷新">
          <RefreshCw size={18} />
        </button>
      </header>

      {error && <p className="inline-error" role="alert">{error}</p>}
      {loading && projects.length === 0 && proposals.length === 0 && !projectError && !proposalError ? (
        <div className="empty-state"><span className="large-loader" /><p>正在整理你的脉络…</p></div>
      ) : (
        <>
          {tab === "active" && (
            <section className="project-section">
              <div className="project-section-head">
                <div className="project-heading"><span className="project-heading-icon suggestion"><Sparkles size={17} /></span><h2>等待你的灵感</h2>{proposals.length > 0 && <span className="project-count">{proposals.length}{proposalCursor ? "+" : ""}</span>}</div>
                <span className="project-section-aside">来自你的记录</span>
              </div>
              {proposalError && <div className="project-inline-state" role="alert">{proposalError}<button type="button" onClick={() => void loadProposals()}>重试</button></div>}
              {proposals.length > 0 ? (
                <div className="proposal-grid">
                  {proposals.map(item => (
                    <button key={item.proposalId} className="proposal-card" type="button" onClick={() => open("proposalId", item.proposalId)}>
                      <div className="proposal-card-top"><span className="proposal-type"><Sparkles size={14} />{item.type === "extend" ? "继续创作" : "创作灵感"}</span><ArrowRight size={19} className="proposal-card-arrow" /></div>
                      <h3>{item.title}</h3>
                      <p>{item.content.idea}</p>
                      {!!item.content.tags?.length && <div className="project-tags">{item.content.tags.map(tag => <span key={tag}>{tag}</span>)}</div>}
                      <span className="proposal-card-foot">看看这个提议 <ChevronRight size={14} /></span>
                    </button>
                  ))}
                </div>
              ) : !proposalError && (
                <div className="project-quiet-state">新的创作灵感出现时，会在这里等你。</div>
              )}
              {proposalCursor && <button type="button" className="project-load-more" disabled={!!loadingMore} onClick={() => void loadMore("proposals")}>{loadingMore === "proposals" ? "正在加载…" : "查看更多提议"}</button>}
            </section>
          )}

          <section className="project-section">
            <div className="project-section-head">
              <div className="project-heading"><span className="project-heading-icon"><BookOpenText size={18} /></span><h2>创作成果</h2></div>
              <div className="project-tabs" role="group" aria-label="成果状态">
                <button type="button" className={tab === "active" ? "is-active" : ""} onClick={() => setTab("active")} aria-pressed={tab === "active"}>进行中</button>
                <button type="button" className={tab === "archived" ? "is-active" : ""} onClick={() => setTab("archived")} aria-pressed={tab === "archived"}>已归档</button>
              </div>
            </div>
            {projectError && <div className="project-inline-state" role="alert">{projectError}<button type="button" onClick={() => void loadProjects(tab)}>重试</button></div>}
            {projects.length > 0 ? (
              <div className="project-grid">
                {projects.map(item => (
                  <button key={item.projectId} className="project-card" type="button" onClick={() => open("projectId", item.projectId)}>
                    <ProjectCover mediaId={item.coverMediaId} />
                    <div className="project-card-copy">
                      <div className="project-card-meta"><span>{item.status === "archived" ? <><Archive size={13} />已归档</> : "你的作品"}</span><time>{dateText(item.updatedAt)}</time></div>
                      <h3>{item.title}</h3>
                      <p>{item.summary || "打开看看这段脉络的最新进展。"}</p>
                      <span className="project-card-link">查看作品 <ArrowRight size={15} /></span>
                    </div>
                  </button>
                ))}
              </div>
            ) : !projectError && !loading && (
              <div className="project-empty">
                <span className="project-empty-symbol"><BookOpenText size={23} strokeWidth={1.5} /></span>
                <h3>{tab === "archived" ? "还没有归档的作品" : "精彩的故事，还在酝酿"}</h3>
                <p>{tab === "archived" ? "归档的作品会留在这里。" : "当一份创作提议被接受，作品就会从这里慢慢长出来。"}</p>
              </div>
            )}
            {projectCursor && <button type="button" className="project-load-more" disabled={!!loadingMore} onClick={() => void loadMore("projects")}>{loadingMore === "projects" ? "正在加载…" : "查看更多作品"}</button>}
          </section>
        </>
      )}

      {(selectedProposalId || selectedProjectId) && (
        <ProjectDetailSheet
          key={selectedProposalId ?? selectedProjectId}
          proposalId={selectedProposalId}
          projectId={selectedProjectId}
          onClose={close}
          onAccepted={onAccepted}
          onRejected={onRejected}
          onArchived={() => { void refresh(tab); close(); }}
        />
      )}
    </div>
  );
}
