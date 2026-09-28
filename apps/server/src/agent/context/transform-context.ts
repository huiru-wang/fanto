import type { Context } from "@earendil-works/pi-agent-core";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

export type MessageTransform = (messages: readonly AgentMessage[], context: Context) => Promise<readonly AgentMessage[] | undefined>;

export function createTransformContext(transform?: MessageTransform): MessageTransform {
  return transform ?? (async messages => messages);
}
