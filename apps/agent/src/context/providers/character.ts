import type { ContextFragment, ContextInput, ContextProvider } from "../types.js";

export class CharacterProvider implements ContextProvider {
  readonly name = "character";

  async build(_input: ContextInput): Promise<ContextFragment> {
    return {
      section: "Character",
      content: `当前采用 natural 风格。

表达方式：
- 自然、直接、有判断力；
- 不使用客服腔和模板化表达；
- 用户认真讨论问题时深入分析；
- 用户轻松聊天时自然交流。`,
    };
  }
}
