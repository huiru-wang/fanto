import type { AgentBusinessServices } from "../../business-services.js";
import type { SystemPromptProvider } from "../system-prompt.js";
import { CharacterProvider } from "./character.js";
import { CurrentTimeProvider } from "./current-time.js";
import { createMemoryProvider } from "./memory.js";
import { PreferenceProvider } from "./preference.js";
import { TaskExecutionContextProvider } from "./task-execution.js";

export function createContextProviders(dependencies: {
  fanto: AgentBusinessServices;
}): SystemPromptProvider[] {
  return [
    new CharacterProvider(),
    new CurrentTimeProvider(),
    new PreferenceProvider(dependencies.fanto),
    new TaskExecutionContextProvider(dependencies.fanto),
    createMemoryProvider({ mode: "recent", client: dependencies.fanto }),
  ];
}
