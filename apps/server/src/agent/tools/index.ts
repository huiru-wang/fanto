import { createProjectReadTool, createProposalCreateTool, createImageGenerateTool, createImageReviewTool, createProjectManageTool } from "./creative.js";
import {
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
  type AgentHarnessTool,
  type ExecutionToolContext,
} from "@earendil-works/pi-agent-core";
import type { AgentDefinition } from "../harness/definition.js";
import type { TaskAgentCatalogEntry } from "../harness/registry.js";
import type { AgentBusinessServices } from "../business-services.js";
import type { SkillLoader } from "../skills/loader.js";
import { prepareBashExecution } from "../workspace/bash.js";
import { createCreateTaskTool, createGetTaskTool, createUpdateTaskTool } from "./task-management.js";
import { createDeliverTaskResultTool } from "./deliver-task-result.js";
import { createTaskPlanManageTool } from "./task-plan-manage.js";
import { createCollectUserInputTool } from "./user-input.js";
import { createWebSearchTool } from "./web-search.js";
import { createPresentMediaTool } from "./media.js";
import { createRecordReadTool } from "./records.js";
import { createMemoryManageTool } from "./memory.js";
import { createSkillReadTool } from "./skills.js";
import type { FantoTool, ToolPresentationConfig } from "./types.js";

export function createTools(
  names: AgentDefinition["tools"],
  workspace: string,
  fanto: AgentBusinessServices,
  taskAgents: readonly TaskAgentCatalogEntry[],
  skills?: SkillLoader,
  allowedSkillIds: readonly string[] = [],
): FantoTool[] {
  return names.map(name => {
    switch (name) {
      case "read": return createFantoReadTool();
      case "write": return createFantoWriteTool();
      case "edit": return createFantoEditTool();
      case "bash": return createFantoBashTool(workspace);
      case "project_read": return createProjectReadTool(fanto);
      case "proposal_create": return createProposalCreateTool(fanto);
      case "image_generate": return createImageGenerateTool(fanto);
      case "image_review": return createImageReviewTool(fanto);
      case "project_manage": return createProjectManageTool(fanto);
      case "record_read": return createRecordReadTool(fanto);
      case "memory_manage": return createMemoryManageTool(fanto);
      case "web_search": return createWebSearchTool(fanto);
      case "present_media": return createPresentMediaTool(fanto);
      case "collect_user_input": return createCollectUserInputTool();
      case "create_task": return createCreateTaskTool(fanto, taskAgents);
      case "update_task": return createUpdateTaskTool(fanto);
      case "get_task": return createGetTaskTool(fanto);
      case "task_plan_manage": return createTaskPlanManageTool(fanto);
      case "deliver_task_result": return createDeliverTaskResultTool(fanto, workspace);
      case "skill_read":
        if (!skills) throw new Error("Skill loader is required for skill_read");
        return createSkillReadTool(skills, allowedSkillIds);
    }
  });
}

function createFantoReadTool(): FantoTool {
  return withPresentation(createReadTool(), {
    visible: true,
    start: { displayContent: "正在处理...", animation: "working" },
    succeeded: { displayContent: "✓ 处理完成" },
    failed: { displayContent: "这一步没有完成" },
  });
}

function createFantoWriteTool(): FantoTool {
  return withPresentation(createWriteTool(), {
    visible: true,
    start: { displayContent: "正在处理...", animation: "working" },
    succeeded: { displayContent: "✓ 处理完成" },
    failed: { displayContent: "这一步没有完成" },
  });
}

function createFantoEditTool(): FantoTool {
  return withPresentation(createEditTool(), {
    visible: true,
    start: { displayContent: "正在处理...", animation: "working" },
    succeeded: { displayContent: "✓ 处理完成" },
    failed: { displayContent: "这一步没有完成" },
  });
}

function createFantoBashTool(workspace: string): FantoTool {
  return withPresentation(
    createBashTool({ prepare: execution => prepareBashExecution(execution, workspace) }),
    {
      visible: true,
      start: { displayContent: "正在处理...", animation: "working" },
      succeeded: { displayContent: "✓ 处理完成" },
      failed: { displayContent: "这一步没有完成" },
    },
  );
}

function withPresentation(
  tool: AgentHarnessTool<ExecutionToolContext>,
  presentation: ToolPresentationConfig,
): FantoTool {
  return { ...tool, presentation };
}
