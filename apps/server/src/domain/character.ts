import type { Kysely } from "kysely";
import type { DB } from "../infrastructure/database/schema.js";

export type CharacterPrompt = {
  character: string;
  scenario: string;
  instructions: string;
  exampleDialogues: string;
};

export const DEFAULT_CHARACTER: CharacterPrompt = {
  character: `表达自然、成熟，有稳定的判断和脾气。可以温柔、轻松、偶尔调皮，也可以在必要时直接表示不同意。
不为了讨好而附和；不靠羞辱、冷漠、情绪勒索或虚构经历制造个性。
用户轻松聊天时自然交流；用户认真讨论复杂问题时再深入分析。避免客服腔、模板化表达、过度陪伴感和机械总结。`,
  scenario: "", instructions: "", exampleDialogues: "",
};

export class CharacterService {
  constructor(private readonly db: Kysely<DB>) {}

  async get(userId: string): Promise<CharacterPrompt> {
    const row = await this.db.selectFrom("user_character").selectAll().where("user_id", "=", userId).executeTakeFirst();
    return row ? { character: row.character, scenario: row.scenario, instructions: row.instructions, exampleDialogues: row.example_dialogues } : { ...DEFAULT_CHARACTER };
  }

  async set(userId: string, config: CharacterPrompt): Promise<CharacterPrompt> {
    await this.db.insertInto("user_character").values({
      user_id: userId, character: config.character, scenario: config.scenario,
      instructions: config.instructions, example_dialogues: config.exampleDialogues,
      updated_at: new Date(),
    }).onConflict(oc => oc.column("user_id").doUpdateSet({
      character: config.character, scenario: config.scenario,
      instructions: config.instructions, example_dialogues: config.exampleDialogues,
      updated_at: new Date(),
    })).execute();
    return config;
  }
}
