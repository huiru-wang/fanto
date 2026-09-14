import type { ExecutionEnv } from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";

export interface SandboxAdapter {
  createExecutionEnv(workspace: string): ExecutionEnv;
}

/** Development adapter only. Production must provide a container or microVM-backed adapter. */
export class LocalSandboxAdapter implements SandboxAdapter {
  createExecutionEnv(workspace: string): ExecutionEnv {
    return new NodeExecutionEnv({ cwd: workspace, shellEnv: {} });
  }
}
