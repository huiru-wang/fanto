import { CreativeContextProvider } from "./creative.js";
import type { AgentBusinessServices } from "../../business-services.js";
import type { SystemPromptProvider } from "../system-prompt.js";
import { CharacterProvider } from "./character.js";
import { CurrentTimeProvider } from "./current-time.js";
import { MemoryProvider } from "./memory.js";
import { createRecordContextProvider } from "./records.js";
import { TaskExecutionContextProvider } from "./task-execution.js";

export function createContextProviders(dependencies: {
  fanto: AgentBusinessServices;
}): SystemPromptProvider[] {
  return [
    new CreativeContextProvider("creative_context", dependencies.fanto),
    new CreativeContextProvider("creation_context", dependencies.fanto),
    new CharacterProvider(),
    new CurrentTimeProvider(),
    new TaskExecutionContextProvider(dependencies.fanto),
    new MemoryProvider(dependencies.fanto),
    createRecordContextProvider({ mode: "recent", client: dependencies.fanto }),
  ];
}
