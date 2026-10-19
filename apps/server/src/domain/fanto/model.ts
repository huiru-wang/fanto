import { z } from "zod";
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
export const rolePatchSchema = z.object({
    character: z.string().max(16000).optional(), scenario: z.string().max(16000).optional(),
    instructions: z.string().max(16000).optional(), exampleDialogues: z.string().max(16000).optional(),
}).strict();
export const settingsPatchSchema = z.object({
    expectedVersion: z.number().int().nonnegative(),
    changes: z.object({
        nickname: z.string().trim().refine(v => [...v].length >= 1 && [...v].length <= 30 && !/[\p{Cc}\p{Cf}]/u.test(v), "昵称需为 1–30 字且不含控制字符").optional(),
        description: z.string().refine(v => [...v].length <= 300, "简介最多 300 字").optional(),
        avatarMediaId: z.string().min(1).max(200).nullable().optional(),
        sessionId: z.string().uuid().nullable().optional(),
        roleConfig: rolePatchSchema.refine(v => Object.keys(v).length > 0).optional(),
    }).strict().refine(v => Object.keys(v).length > 0),
}).strict();
export type SettingsChanges = z.infer<typeof settingsPatchSchema>["changes"];
export type RoleConfig = CharacterPrompt & Record<string, unknown>;
export type FantoSettings = {
    fantoId: string | null;
    nickname: string;
    description: string;
    avatarMediaId: string | null;
    sessionId: string | null;
    roleConfig: RoleConfig;
    version: number;
    createdAt: string | null;
    updatedAt: string | null;
};
export const emptyRole = (): CharacterPrompt => ({ character: "", scenario: "", instructions: "", exampleDialogues: "" });
export const defaultSettings = (): FantoSettings => ({ fantoId: null, nickname: "Fanto", description: "", avatarMediaId: null, sessionId: null, roleConfig: emptyRole(), version: 0, createdAt: null, updatedAt: null });
export class FantoError extends Error {
    constructor(readonly code: "VERSION_CONFLICT" | "INVALID_AVATAR" | "INVALID_SESSION", readonly status: 409 | 422) { super(code === "VERSION_CONFLICT" ? "设置已在其他地方更新，请重新读取后确认。" : code === "INVALID_SESSION" ? "会话无效或不属于当前用户。" : "头像无效，请重新选择图片。"); }
}
