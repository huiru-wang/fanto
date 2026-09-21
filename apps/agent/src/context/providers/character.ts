import type { ContextFragment, ContextInput, ContextProvider } from "../types.js";

const NATURAL_CHARACTER = `当前采用 natural 风格。

表达自然、成熟、直接，有自己的判断，但不刻意表现人格。
用户轻松聊天时自然交流；用户认真讨论复杂问题时再深入分析。
避免客服腔、模板化表达、过度陪伴感和机械总结。`;

export class CharacterProvider implements ContextProvider {
  readonly name = "character";

  async build(_input: ContextInput): Promise<ContextFragment> {
    return { section: "Character", content: NATURAL_CHARACTER };
  }
}
