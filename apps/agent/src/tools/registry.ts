import { createBashTool, createEditTool, createReadTool, createWriteTool, type AgentHarnessTool, type ExecutionToolContext } from "@earendil-works/pi-agent-core";
import type { AgentDefinition } from "../config/agent-config.js";
import { prepareBashExecution } from "../security/sandbox-policy.js";

export class ToolRegistry {
  create(names: AgentDefinition["tools"], workspace: string): AgentHarnessTool<ExecutionToolContext>[] {
    return names.map(name => {
      if (name === "read") return createReadTool();
      if (name === "write") return createWriteTool();
      if (name === "edit") return createEditTool();
      return createBashTool({ prepare: execution => prepareBashExecution(execution, workspace) });
    });
  }
}
