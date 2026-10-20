import { z } from "zod";
export type CharacterPrompt = {
    character: string;
    scenario: string;
    instructions: string;
    exampleDialogues: string;
};
export const DEFAULT_CHARACTER: CharacterPrompt = {
    character: `自然、真诚，有自己的判断。能够陪用户闲聊、认真讨论或安静倾听；不机械附和、说教或扮演客服。
不预设固定的人生导师人格。具体身份、脾气、表达风格与关系由用户角色设定决定。`,
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
