import type { Kysely } from "kysely";
import type { DB } from "../../infrastructure/database/schema.js";
import type { MediaService } from "../media/index.js";
import { PostgresFantoRepository } from "./postgres-repository.js";
import { DEFAULT_CHARACTER, defaultSettings, emptyRole, settingsPatchSchema, type CharacterPrompt, type FantoSettings } from "./model.js";
export class FantoService {
    constructor(private readonly repository: Pick<PostgresFantoRepository, "find" | "update">, private readonly media: Pick<MediaService, "validateAvatar">) { }
    static create(db: Kysely<DB>, media: MediaService) { return new FantoService(new PostgresFantoRepository(db), media); }
    async getSettings(userId: string): Promise<FantoSettings> { return await this.repository.find(userId) ?? defaultSettings(); }
    async updateSettings(userId: string, input: unknown) {
        const parsed = settingsPatchSchema.parse(input);
        return this.repository.update(userId, parsed.expectedVersion, parsed.changes, (u, id, trx) => this.media.validateAvatar(u, id, trx));
    }
    async getConversationSettings(userId: string) {
        const settings = await this.getSettings(userId);
        return { nickname: settings.nickname, ...this.projectRole(settings) };
    }
    async getLegacyCharacter(userId: string): Promise<CharacterPrompt> {
        const settings = await this.repository.find(userId);
        return settings ? this.projectRole(settings) : { ...DEFAULT_CHARACTER };
    }
    async replaceLegacyCharacter(userId: string, roleConfig: CharacterPrompt): Promise<CharacterPrompt> {
        return this.projectRole(await this.repository.update(userId, null, { roleConfig }, (u, id, trx) => this.media.validateAvatar(u, id, trx)));
    }
    private projectRole(settings: FantoSettings): CharacterPrompt {
        const role = emptyRole();
        for (const key of Object.keys(role) as (keyof CharacterPrompt)[])
            role[key] = typeof settings.roleConfig[key] === "string" ? settings.roleConfig[key] : "";
        return role;
    }
}
