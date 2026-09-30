import { ListTodo, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { listTasks, type TaskDto } from "../api/tasks";
import { TaskDetailModal } from "../components/tasks/TaskDetailModal";
import { TaskListItem } from "../components/tasks/TaskListItem";

export function TasksPage() {
  const [tasks, setTasks] = useState<TaskDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedTaskId = searchParams.get("taskId");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTasks(await listTasks());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "暂时无法读取任务");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const openTask = (taskId: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("taskId", taskId);
    setSearchParams(next);
  };

  const closeTask = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("taskId");
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="page tasks-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Fanto 在后台做的事</p>
          <h1>任务</h1>
          <p className="page-description">查看已经交给 Fanto 的任务、执行状态和最终结果。</p>
        </div>
        <button className="icon-button" onClick={() => void load()} aria-label="刷新任务" title="刷新">
          <RefreshCw size={18} />
        </button>
      </header>

      {loading ? (
        <div className="empty-state"><span className="large-loader" /><p>正在读取任务…</p></div>
      ) : error && tasks.length === 0 ? (
        <div className="empty-state">
          <div className="empty-orb"><RefreshCw size={22} /></div>
          <h2>暂时没有读取到任务</h2>
          <p>{error}</p>
          <button className="secondary-button" onClick={() => void load()}><RefreshCw size={16} />重新加载</button>
        </div>
      ) : tasks.length === 0 ? (
        <div className="empty-state task-empty-state">
          <div className="empty-orb"><ListTodo size={24} /></div>
          <h2>还没有后台任务</h2>
          <p>当 Fanto 把一件事交给后台处理后，会出现在这里。</p>
        </div>
      ) : (
        <div className="task-list panel">
          {tasks.map(task => <TaskListItem key={task.taskId} task={task} onOpen={() => openTask(task.taskId)} />)}
        </div>
      )}

      {error && tasks.length > 0 && <div className="task-page-error">{error}</div>}

      {selectedTaskId && (
        <TaskDetailModal taskId={selectedTaskId} onClose={closeTask} onChanged={() => void load()} />
      )}
    </div>
  );
}
