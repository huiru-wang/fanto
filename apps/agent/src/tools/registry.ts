import { createBashTool, createEditTool, createReadTool, createWriteTool, type AgentHarnessTool, type ExecutionToolContext } from "@earendil-works/pi-agent-core";
import type { FantoServerClient } from "../clients/fanto-server-client.js";
import type { AgentDefinition } from "../config/agent-config.js";
import { prepareBashExecution } from "../security/sandbox-policy.js";
import { createRecordGetTool, createRecordListTool, createRecordSearchTool } from "./record-tools.js";
import { createPresentMediaTool } from "./present-media-tool.js";

export class ToolRegistry {
  constructor(private readonly fanto?: FantoServerClient) {}

  create(names: AgentDefinition["tools"], workspace: string): AgentHarnessTool<ExecutionToolContext>[] {
    return names.map(name => {
      switch (name) {
        case "read": return createReadTool();
        case "write": return createWriteTool();
        case "edit": return createEditTool();
        case "bash": return createBashTool({ prepare: execution => prepareBashExecution(execution, workspace) });
        case "record_get": return createRecordGetTool(this.requireFantoClient());
        case "record_list": return createRecordListTool(this.requireFantoClient());
        case "record_search": return createRecordSearchTool(this.requireFantoClient());
        case "present_media": return createPresentMediaTool(this.requireFantoClient());
      }
    });
  }

  private requireFantoClient(): FantoServerClient {
    if (!this.fanto) throw new Error("FantoServerClient is required for Record tools");
    return this.fanto;
  }
}
