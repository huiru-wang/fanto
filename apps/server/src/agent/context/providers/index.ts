import type {AgentBusinessServices} from "../../business-services.js";
import type {SystemPromptProvider} from "../system-prompt.js";
import {CurrentTimeProvider} from "./current-time.js";
import {MainDynamicProvider} from "./main-dynamic.js";
export function createContextProviders(dependencies:{fanto:AgentBusinessServices}):SystemPromptProvider[]{
 return [new MainDynamicProvider(dependencies.fanto),new CurrentTimeProvider()];
}
