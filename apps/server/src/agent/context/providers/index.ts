import type { AgentBusinessServices } from "../../business-services.js";
import type { SystemPromptProvider } from "../system-prompt.js";
import { CharacterProvider } from "./character.js";
import { CurrentTimeProvider } from "./current-time.js";
import { MemoryProvider, RelevantMemoryProvider } from "./memory.js";
import { createRecordContextProvider } from "./records.js";

export function createContextProviders(dependencies: {
  fanto: AgentBusinessServices;
}): SystemPromptProvider[] {
  return [
    new CharacterProvider(dependencies.fanto),
    new CurrentTimeProvider(),
    new MemoryProvider(dependencies.fanto),
    new RelevantMemoryProvider(dependencies.fanto),
    createRecordContextProvider({ mode: "recent", client: dependencies.fanto }),
  ];
}
