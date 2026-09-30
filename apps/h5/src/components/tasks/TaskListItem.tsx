import { ChevronRight } from "lucide-react";
import type { TaskDto } from "../../api/tasks";

const STATUS_LABEL: Record<TaskDto["status"], string> = {
  active: "已启用",
  paused: "已暂停",
  completed: "已完成",
  cancelled: "已取消",
};

function taskType(task: TaskDto) {
  if (task.trigger.type === "immediate") return "单次任务";
  return task.trigger.schedule.type === "recurring" ? "周期任务" : "定时任务";
}

export function TaskListItem({ task, onOpen }: { task: TaskDto; onOpen: () => void }) {
  return (
    <button type="button" className="task-list-item compact-task-item" onClick={onOpen}>
      <span className={`task-list-status is-${task.status}`} aria-hidden="true" />
      <span className="task-list-main">
        <strong>{task.title}</strong>
        <span>{STATUS_LABEL[task.status]} · {taskType(task)}</span>
      </span>
      <ChevronRight size={18} className="task-list-chevron" />
    </button>
  );
}
