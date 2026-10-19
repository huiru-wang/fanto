import { requestJson } from "./http";
export type RoleConfig = {
    character: string;
    scenario: string;
    instructions: string;
    exampleDialogues: string;
};
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
export type SettingsChanges = Partial<Pick<FantoSettings, "nickname" | "description" | "avatarMediaId" | "sessionId">> & {
    roleConfig?: Partial<RoleConfig>;
};
export const getFantoSettings = (signal?: AbortSignal) => requestJson<FantoSettings>("/api/fanto/settings", { signal });
export const patchFantoSettings = (expectedVersion: number, changes: SettingsChanges) => requestJson<FantoSettings>("/api/fanto/settings", { method: "PATCH", body: JSON.stringify({ expectedVersion, changes }) });
export { textChanges, rebaseText } from "../fanto/settings-state";
