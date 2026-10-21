import { requestJson } from "./http";

export type RoleConfig = {
  character: string;
  scenario: string;
  instructions: string;
  exampleDialogues: string;
};
export type AgentConfig = {
  recordReadEnabled: boolean;
  fantoMemoryEnabled: boolean;
  narrationEnabled: boolean;
};
export type FantoSettings = {
  fantoId: string;
  userId: string;
  nickname: string;
  description: string;
  avatarMediaId: string | null;
  sessionId: string;
  roleConfig: RoleConfig;
  agentConfig: AgentConfig;
  status: "active" | "archived";
  archivedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};
export type CreateFanto = {
  nickname: string;
  description: string;
  roleConfig: RoleConfig;
  agentConfig: AgentConfig;
  avatarMediaId?: string | null;
};
export type SettingsChanges = {
  agentConfig?: Partial<AgentConfig>;
  avatarMediaId?: string | null;
};
export const emptyFanto = (): CreateFanto => ({
  nickname: "", description: "", roleConfig: { character: "", scenario: "", instructions: "", exampleDialogues: "" },
  agentConfig: { recordReadEnabled: false, fantoMemoryEnabled: true, narrationEnabled: true },
});
export const listFantos = (signal?: AbortSignal) => requestJson<FantoSettings[]>("/api/fantos?includeArchived=true", { signal });
export const getFanto = (id: string) => requestJson<FantoSettings>(`/api/fanto?fantoId=${encodeURIComponent(id)}`);
export const createFanto = (input: CreateFanto) => requestJson<FantoSettings>("/api/fanto", { method: "POST", body: JSON.stringify(input) });
export const patchFanto = (fantoId: string, expectedVersion: number, changes: SettingsChanges) =>
  requestJson<FantoSettings>("/api/fanto", { method: "PATCH", body: JSON.stringify({ fantoId, expectedVersion, changes }) });
export const setFantoArchived = (fantoId: string, expectedVersion: number, archived: boolean) =>
  requestJson<FantoSettings>(`/api/fanto/${archived ? "archive" : "restore"}`, { method: "POST", body: JSON.stringify({ fantoId, expectedVersion }) });
export const deleteFanto = (fantoId: string, expectedVersion: number) =>
  requestJson<{ fantoId: string; deletionState: "pending" } | null>(`/api/fanto?fantoId=${encodeURIComponent(fantoId)}`, {
    method: "DELETE", headers: { "If-Match": String(expectedVersion) },
  });

export const restartFanto = (fantoId: string, expectedVersion: number) =>
  requestJson<FantoSettings>("/api/fanto/restart", { method: "POST", body: JSON.stringify({ fantoId, expectedVersion }) });
