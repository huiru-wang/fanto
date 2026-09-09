import { Agent } from "@earendil-works/pi-agent-core";
import type { AgentEvent, StreamFn } from "@earendil-works/pi-agent-core";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import type { AppConfig } from "../env.js";
import { nowIso } from "../infrastructure/time.js";
import type { MessageRepository } from "../modules/message/message.repository.js";

export interface AgentRuntime {
  agent: Agent;
  cleanup: () => void;
}

export interface CreateAgentRuntimeOptions {
  config: AppConfig;
  messageRepo: MessageRepository;
  userId: string;
  sessionId: string;
}

export async function createAgentRuntime(opts: CreateAgentRuntimeOptions): Promise<AgentRuntime> {
  const models = builtinModels();
  const streamFn: StreamFn = models.streamSimple.bind(models);
  const model = models.getModel(opts.config.provider, opts.config.model)
    ?? models.getModels().find((item) => item.id === opts.config.model)
    ?? (() => { throw new Error(`Model "${opts.config.model}" not found`); })();
  const agent = new Agent({ streamFn, sessionId: opts.sessionId, initialState: { model } });
  const unsubscribe = agent.subscribe(async (event: AgentEvent) => {
    const now = nowIso();
    await opts.messageRepo.save({
      userId: opts.userId,
      sessionId: opts.sessionId,
      role: event.type,
      payload: JSON.stringify(event),
      createdAt: now,
      updatedAt: now,
    });
  });
  return { agent, cleanup: unsubscribe };
}
