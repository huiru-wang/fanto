import { AlertCircle, Eye, FileText, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getTask, listTaskRuns, type TaskArtifactDto, type TaskDto, type TaskRunDto } from "../../api/tasks";
import { TaskArtifactPreview } from "./TaskArtifactPreview";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function TaskDetailModal({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const [task, setTask] = useState<TaskDto | null>(null);
  const [runs, setRuns] = useState<TaskRunDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewArtifact, setPreviewArtifact] = useState<TaskArtifactDto | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextTask, nextRuns] = await Promise.all([getTask(taskId), listTaskRuns(taskId)]);
      setTask(nextTask);
      setRuns(nextRuns);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "暂时无法读取任务详情");
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => { void load(); }, [load]);

  const latestRun = runs[0] ?? null;
  const running = latestRun?.status === "running";

  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void listTaskRuns(taskId).then(next => {
        if (!cancelled) setRuns(next);
      }).catch(() => {});
    }, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [running, taskId]);

  const artifacts = useMemo(() => latestRun?.result?.artifacts ?? [], [latestRun]);

  return (
    <div className="task-modal-backdrop" role="presentation" onMouseDown={event => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="task-detail-modal simple-task-detail" role="dialog" aria-modal="true" aria-label="任务详情">
        <header className="task-detail-header">
          <div>
            <p className="eyebrow">Task</p>
            <h2>{task?.title ?? "任务详情"}</h2>
          </div>
          <button type="button" className="icon-button compact" onClick={onClose} aria-label="关闭"><X size={19} /></button>
        </header>

        {loading ? (
          <div className="task-detail-state"><span className="large-loader" /><p>正在读取任务…</p></div>
        ) : error && !task ? (
          <div className="task-detail-state error"><AlertCircle size={21} /><p>{error}</p></div>
        ) : task ? (
          <div className="task-detail-scroll simple-task-detail-scroll">
            <section className="task-detail-section">
              <h3>目标</h3>
              <p className="task-objective">{task.goal.objective}</p>
              {task.goal.context && <p className="task-goal-context">{task.goal.context}</p>}
              {!!task.goal.constraints?.length && (
                <div className="task-goal-list"><strong>要求</strong><ul>{task.goal.constraints.map(item => <li key={item}>{item}</li>)}</ul></div>
              )}
              {!!task.goal.successCriteria?.length && (
                <div className="task-goal-list"><strong>完成标准</strong><ul>{task.goal.successCriteria.map(item => <li key={item}>{item}</li>)}</ul></div>
              )}
            </section>

            <section className="task-detail-section">
              <h3>计划</h3>
              {latestRun?.plan ? (
                <div className="task-plan-simple">
                  <p>{latestRun.plan.summary}</p>
                  <ol>{latestRun.plan.steps.map(step => <li key={step.id}><strong>{step.title}</strong>{step.description && <span>{step.description}</span>}</li>)}</ol>
                </div>
              ) : (
                <p className="task-empty-copy">{running ? "正在整理执行计划…" : "暂未生成执行计划。"}</p>
              )}
            </section>

            <section className="task-detail-section">
              <h3>结果</h3>
              {latestRun?.result?.summary ? <p className="task-result-summary">{latestRun.result.summary}</p> : (
                <p className="task-empty-copy">{running ? "任务正在执行。" : latestRun?.error?.message ?? "还没有生成结果。"}</p>
              )}
              {artifacts.length > 0 && (
                <div className="task-artifact-list simple-artifact-list">
                  {artifacts.map(artifact => (
                    <div className="task-artifact-row" key={artifact.mediaId}>
                      <span className="task-artifact-icon"><FileText size={16} /></span>
                      <span className="task-artifact-copy">
                        <strong>{artifact.filename}</strong>
                        <small>{formatBytes(artifact.bytes)}</small>
                      </span>
                      <button type="button" className="artifact-preview-button" onClick={() => setPreviewArtifact(artifact)}><Eye size={15} />预览</button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        ) : null}
      </section>
      {previewArtifact && <TaskArtifactPreview artifact={previewArtifact} onClose={() => setPreviewArtifact(null)} />}
    </div>
  );
}
