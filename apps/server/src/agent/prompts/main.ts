import {fantoCore} from "./fanto-core.js";
/** All optional persona, permissions and memory enter through a single per-run resolved slot. */
export const mainPrompt = fantoCore + "\n\n{{dynamic_main}}\n\n## Current Time\n{{current_time}}";
