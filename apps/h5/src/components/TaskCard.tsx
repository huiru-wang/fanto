import { CalendarClock, ChevronRight, Clock3 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { PresentedTask } from "../api/agent";

function localDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function formatLabel(format: PresentedTask["output"]["format"]) {
  return format === "html" ? "HTML" : format === "markdown" ? "Markdown" : "文本";
}

function statusLabel(task: PresentedTask) {
  if (task.trigger.type === "immediate") return "已创建后台任务";
  if (task.trigger.schedule.type === "once") return `已安排 · ${localDateTime(task.trigger.schedule.at)}`;
  return "周期任务已创建";
}

export function TaskCard({ task }: { task: PresentedTask }) {
  const navigate = useNavigate();
  const scheduled = task.trigger.type === "scheduled";
  const Icon = scheduled ? CalendarClock : Clock3;

  return (
    <button
      type="button"
      className="chat-task-card"
      onClick={() => navigate(`/tasks?taskId=${encodeURIComponent(task.taskId)}`)}
    >
      <span className="chat-task-icon"><Icon size={17} strokeWidth={1.8} /></span>
      <span className="chat-task-copy">
        <span className="chat-task-status">{statusLabel(task)} · {formatLabel(task.output.format)}</span>
        <strong>{task.title}</strong>
      </span>
      <span className="chat-task-action">查看任务 <ChevronRight size={15} /></span>
    </button>
  );
}
