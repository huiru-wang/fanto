import { AlertCircle, CalendarClock, CheckCircle2, Clock3, Eye, FileText, Pause, Play, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  cancelTask,
  getTask,
  listTaskRuns,
  pauseTask,
  resumeTask,
  type TaskArtifactDto,
  type TaskDto,
  type TaskRunDto,
} from "../../api/tasks";
import { TaskArtifactPreview } from "./TaskArtifactPreview";

const TASK_STATUS: Record<TaskDto["status"], string> = {
  active: "已启用",
  paused: "已暂停",
  completed: "已完成",
  cancelled: "已取消",
};

const RUN_STATUS: Record<TaskRunDto["status"], string> = {
  running: "正在执行",
  completed: "已完成",
  failed: "执行失败",
  cancelled: "已取消",
};

function dateTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function outputLabel(task: TaskDto) {
  return task.output.format === "html" ? "HTML" : task.output.format === "markdown" ? "Markdown" : "文本";
}

function triggerLabel(task: TaskDto) {
  if (task.trigger.type === "immediate") return "立即执行";
  if (task.trigger.schedule.type === "once") return `定时执行 · ${dateTime(task.trigger.schedule.at)}`;
  return `周期执行 · ${task.trigger.schedule.timezone}`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function TaskDetailModal({
  taskId,
  onClose,
  onChanged,
}: {
  taskId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [task, setTask] = useState<TaskDto | null>(null);
  const [runs, setRuns] = useState<TaskRunDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
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

  const hasRunningRun = useMemo(() => runs.some(run => run.status === "running"), [runs]);

  useEffect(() => {
    if (!hasRunningRun) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void listTaskRuns(taskId)
        .then(async nextRuns => {
          if (cancelled) return;
          const stillRunning = nextRuns.some(run => run.status === "running");
          setRuns(nextRuns);
          if (!stillRunning) {
            const nextTask = await getTask(taskId);
            if (!cancelled) {
              setTask(nextTask);
              onChanged();
            }
          }
        })
        .catch(() => {});
    }, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [hasRunningRun, onChanged, taskId]);

  const act = async (action: "pause" | "resume" | "cancel") => {
    if (!task || acting) return;
    if (action === "cancel" && !window.confirm("取消这个任务？取消后不会再执行。")) return;
    setActing(true);
    setError(null);
    try {
      const next = action === "pause"
        ? await pauseTask(task.taskId)
        : action === "resume"
          ? await resumeTask(task.taskId)
          : await cancelTask(task.taskId);
      setTask(next);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作没有完成");
    } finally {
      setActing(false);
    }
  };

  return (
    <div className="task-modal-backdrop" role="presentation" onMouseDown={event => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="task-detail-modal" role="dialog" aria-modal="true" aria-label="任务详情">
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
          <div className="task-detail-scroll">
            <div className="task-detail-summary">
              <span className={`task-status-pill is-${task.status}`}>{TASK_STATUS[task.status]}</span>
              <span><FileText size={15} />{outputLabel(task)}</span>
              <span>{task.trigger.type === "immediate" ? <Clock3 size={15} /> : <CalendarClock size={15} />}{triggerLabel(task)}</span>
            </div>

            <section className="task-detail-section">
              <h3>目标</h3>
              <p className="task-objective">{task.goal.objective}</p>
              {(task.goal.context || task.goal.constraints?.length || task.goal.successCriteria?.length) && (
                <details className="task-requirements">
                  <summary>任务要求</summary>
                  {task.goal.context && <p>{task.goal.context}</p>}
                  {!!task.goal.constraints?.length && <div><strong>限制</strong><ul>{task.goal.constraints.map(item => <li key={item}>{item}</li>)}</ul></div>}
                  {!!task.goal.successCriteria?.length && <div><strong>完成标准</strong><ul>{task.goal.successCriteria.map(item => <li key={item}>{item}</li>)}</ul></div>}
                </details>
              )}
              <div className="task-facts">
                <span><small>创建时间</small>{dateTime(task.createdAt)}</span>
                <span><small>下次执行</small>{dateTime(task.nextRunAt)}</span>
              </div>
            </section>

            {(task.status === "active" || task.status === "paused") && (
              <section className="task-detail-actions">
                {task.status === "active" && !hasRunningRun ? (
                  <button type="button" className="secondary-button" disabled={acting} onClick={() => void act("pause")}><Pause size={16} />暂停</button>
                ) : task.status === "paused" ? (
                  <button type="button" className="secondary-button" disabled={acting} onClick={() => void act("resume")}><Play size={16} />恢复</button>
                ) : null}
                <button type="button" className="secondary-button danger" disabled={acting} onClick={() => void act("cancel")}><Trash2 size={16} />取消任务</button>
              </section>
            )}

            {error && <div className="task-inline-error"><AlertCircle size={16} />{error}</div>}

            <section className="task-detail-section task-runs-section">
              <h3>执行记录</h3>
              {runs.length === 0 ? (
                <p className="task-empty-copy">还没有执行记录。</p>
              ) : (
                <div className="task-run-list">
                  {runs.map(run => (
                    <article className={`task-run-card is-${run.status}`} key={run.runId}>
                      <div className="task-run-heading">
                        <div>
                          {run.status === "completed" ? <CheckCircle2 size={17} /> : <Clock3 size={17} />}
                          <strong>{RUN_STATUS[run.status]}</strong>
                        </div>
                        <span>{dateTime(run.startedAt ?? run.scheduledAt)}</span>
                      </div>
                      {run.status === "running" && <p>任务正在后台执行。</p>}
                      {run.error && <p className="task-run-error">{run.error.message}</p>}
                      {run.result && (
                        <>
                          <p>{run.result.summary}</p>
                          <div className="task-artifact-list">
                            {run.result.artifacts.map(artifact => (
                              <div className="task-artifact-row" key={artifact.mediaId}>
                                <span className="task-artifact-icon"><FileText size={16} /></span>
                                <span className="task-artifact-copy">
                                  <strong>{artifact.filename}</strong>
                                  <small>{artifact.mimeType} · {formatBytes(artifact.bytes)}</small>
                                </span>
                                <button type="button" className="artifact-preview-button" onClick={() => setPreviewArtifact(artifact)}><Eye size={15} />预览</button>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </article>
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
