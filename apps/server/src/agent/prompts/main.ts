import {fantoCore} from "./fanto-core.js";
/** All optional persona, permissions and memory enter through a single per-run resolved slot. */
export const mainPrompt = fantoCore + "\n\n{{dynamic_main}}\n\n## 外部现实时间参考（不是故事时间）\n{{current_time}}";
