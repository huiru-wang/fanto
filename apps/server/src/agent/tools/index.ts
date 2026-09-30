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
import { prepareBashExecution } from "../workspace/bash.js";
import { createCreateTaskTool, createGetTaskTool, createUpdateTaskTool } from "./task-management.js";
import { createDeliverTaskResultTool } from "./deliver-task-result.js";
import { createTaskPlanManageTool } from "./task-plan-manage.js";
import { createCollectUserInputTool } from "./user-input.js";
import { createWebSearchTool } from "./web-search.js";
import { createPresentMediaTool } from "./media.js";
import { createPreferenceManageTool } from "./preferences.js";
import { createRecordGetTool, createRecordListTool, createRecordSearchTool } from "./records.js";

export function createTools(
  names: AgentDefinition["tools"],
  workspace: string,
  fanto: AgentBusinessServices,
  taskAgents: readonly TaskAgentCatalogEntry[],
): AgentHarnessTool<ExecutionToolContext>[] {
  return names.map(name => {
    switch (name) {
      case "read": return createReadTool();
      case "write": return createWriteTool();
      case "edit": return createEditTool();
      case "bash": return createBashTool({ prepare: execution => prepareBashExecution(execution, workspace) });
      case "record_get": return createRecordGetTool(fanto);
      case "record_list": return createRecordListTool(fanto);
      case "record_search": return createRecordSearchTool(fanto);
      case "web_search": return createWebSearchTool(fanto);
      case "present_media": return createPresentMediaTool(fanto);
      case "preference_manage": return createPreferenceManageTool(fanto);
      case "collect_user_input": return createCollectUserInputTool();
      case "create_task": return createCreateTaskTool(fanto, taskAgents);
      case "update_task": return createUpdateTaskTool(fanto);
      case "get_task": return createGetTaskTool(fanto);
      case "task_plan_manage": return createTaskPlanManageTool(fanto);
      case "deliver_task_result": return createDeliverTaskResultTool(fanto, workspace);
    }
  });
}
