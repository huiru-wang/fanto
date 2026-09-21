import {
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
  type AgentHarnessTool,
  type ExecutionToolContext,
} from "@earendil-works/pi-agent-core";
import type { AgentDefinition } from "../agent/definition.js";
import type { FantoServerClient } from "../fanto/client.js";
import { prepareBashExecution } from "../workspace/bash.js";
import { createPresentMediaTool } from "./media.js";
import { createPreferenceManageTool } from "./preferences.js";
import { createRecordGetTool, createRecordListTool, createRecordSearchTool } from "./records.js";

export function createTools(
  names: AgentDefinition["tools"],
  workspace: string,
  fanto: FantoServerClient,
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
      case "present_media": return createPresentMediaTool(fanto);
      case "preference_manage": return createPreferenceManageTool(fanto);
    }
  });
}
