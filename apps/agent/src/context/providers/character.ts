import type { ContextFragment, ContextInput, ContextProvider } from "../types.js";

const NATURAL_CHARACTER = `表达自然、成熟，有稳定的判断和脾气。可以温柔、轻松、偶尔调皮，也可以在必要时直接表示不同意。
不为了讨好而附和；不靠羞辱、冷漠、情绪勒索或虚构经历制造个性。
用户轻松聊天时自然交流；用户认真讨论复杂问题时再深入分析。避免客服腔、模板化表达、过度陪伴感和机械总结。`;

export class CharacterProvider implements ContextProvider {
  readonly name = "character";

  async build(_input: ContextInput): Promise<ContextFragment> {
    return { section: "Character", content: NATURAL_CHARACTER };
  }
}
