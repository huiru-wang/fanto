import type { Task, TaskGoal } from "../../domain/tasks/index.js";
export function renderTaskBrief(task: Task): string {
  const sections = [
    "# Task Brief",
    "",
    "## Objective",
    task.goal.objective,
  ];

  pushOptionalSection(sections, "Context", task.goal.context);
  pushListSection(sections, "Constraints", task.goal.constraints);
  pushListSection(sections, "Success Criteria", task.goal.successCriteria);
  return sections.join("\n");
}

export function taskTraceId(task: Task): string | undefined {
  return typeof task.extData.traceId === "string" && task.extData.traceId
    ? task.extData.traceId
    : undefined;
}

export function taskTimeZone(task: Task): string {
  if (task.trigger.type === "scheduled") return task.trigger.schedule.timezone;
  return typeof task.extData.timeZone === "string" && task.extData.timeZone ? task.extData.timeZone : "UTC";
}

function pushOptionalSection(sections: string[], title: string, value: string | undefined): void {
  if (!value?.trim()) return;
  sections.push("", `## ${title}`, value.trim());
}

function pushListSection(sections: string[], title: string, values: TaskGoal["constraints"]): void {
  const normalized = values?.map(value => value.trim()).filter(Boolean);
  if (!normalized?.length) return;
  sections.push("", `## ${title}`, ...normalized.map(value => `- ${value}`));
}
