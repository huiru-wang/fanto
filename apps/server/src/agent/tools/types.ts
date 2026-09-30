import type { AgentHarnessTool, ExecutionToolContext } from "@earendil-works/pi-agent-core";
import type { TSchema } from "typebox";

export type ToolPresentationAnimation = "thinking" | "searching" | "working";

export type ToolPresentationConfig =
  | { visible: false }
  | {
      visible: true;
      start: { displayContent: string; animation?: ToolPresentationAnimation };
      succeeded: { displayContent: string };
      failed: { displayContent: string };
    };

export type FantoTool<
  TParameters extends TSchema = TSchema,
  TDetails = unknown,
> = AgentHarnessTool<ExecutionToolContext, TParameters, TDetails> & {
  presentation: ToolPresentationConfig;
};
