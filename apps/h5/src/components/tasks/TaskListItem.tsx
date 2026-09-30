import { CalendarClock, ChevronRight, Clock3, FileText } from "lucide-react";
import type { TaskDto } from "../../api/tasks";

const STATUS_LABEL: Record<TaskDto["status"], string> = {
  active: "已启用",
  paused: "已暂停",
  completed: "已完成",
  cancelled: "已取消",
};

function formatLabel(format: TaskDto["output"]["format"]) {
  return format === "html" ? "HTML" : format === "markdown" ? "Markdown" : "文本";
}

function localDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function triggerLabel(task: TaskDto) {
  if (task.trigger.type === "immediate") return "立即任务";
  if (task.trigger.schedule.type === "once") return `定时 · ${localDateTime(task.trigger.schedule.at)}`;
  return "周期任务";
}

export function TaskListItem({ task, onOpen }: { task: TaskDto; onOpen: () => void }) {
  const TriggerIcon = task.trigger.type === "immediate" ? Clock3 : CalendarClock;
  return (
    <button type="button" className="task-list-item" onClick={onOpen}>
      <span className={`task-list-status is-${task.status}`} aria-hidden="true" />
      <span className="task-list-main">
        <strong>{task.title}</strong>
        <span>{STATUS_LABEL[task.status]} · {triggerLabel(task)}</span>
      </span>
      <span className="task-list-meta">
        <span><FileText size={14} />{formatLabel(task.output.format)}</span>
        {task.nextRunAt && <span><TriggerIcon size={14} />{localDateTime(task.nextRunAt)}</span>}
      </span>
      <ChevronRight size={18} className="task-list-chevron" />
    </button>
  );
}
