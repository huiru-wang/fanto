import type { AgentConfig, FantoSettings, SettingsChanges } from "../api/fanto";

export function configChanges(base: AgentConfig, draft: AgentConfig): SettingsChanges {
  const changes: Partial<AgentConfig> = {};
  for (const key of Object.keys(base) as (keyof AgentConfig)[]) {
    if (base[key] !== draft[key]) changes[key] = draft[key];
  }
  return Object.keys(changes).length ? { agentConfig: changes } : {};
}

export function rebaseConfig(base: AgentConfig, draft: AgentConfig, remote: AgentConfig) {
  const changes = configChanges(base, draft).agentConfig ?? {};
  const conflicts = (Object.keys(changes) as (keyof AgentConfig)[])
    .filter(key => remote[key] !== base[key] && remote[key] !== draft[key]);
  return { draft: { ...remote, ...changes }, conflicts };
}

export function mergeFanto(roles: FantoSettings[], incoming: FantoSettings): FantoSettings[] {
  const existing = roles.find(role => role.fantoId === incoming.fantoId);
  if (existing && existing.version > incoming.version) return roles;
  return [...roles.filter(role => role.fantoId !== incoming.fantoId), incoming]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.fantoId.localeCompare(a.fantoId));
}

/** The default Session must belong to the same active, named default Fanto returned by the Server. */
export function matchingDefaultFanto(roles: FantoSettings[], main: { agentId: string; scopeKey: string; sessionId: string }, userId: string): FantoSettings | null {
  if (main.agentId !== "main") return null;
  return roles.find(role => role.userId === userId && role.fantoId === main.scopeKey
    && role.nickname === "fanto" && role.status === "active" && role.sessionId === main.sessionId) ?? null;
}

/** Missing, archived and legacy "default" selections resolve to the real default Fanto ID. */
export function usableSelection(selectedId: string | null | undefined, roles: FantoSettings[], defaultId: string | null): string | null {
  if (selectedId && roles.some(role => role.fantoId === selectedId && role.status === "active")) return selectedId;
  return roles.some(role => role.fantoId === defaultId && role.status === "active") ? defaultId : null;
}

/** Mirrors the Server's nickname rules; the database remains authoritative. */
export function nicknameError(name: string, roles: FantoSettings[]): string | null {
  const value = name.trim();
  if (!value) return "请输入角色名称";
  if (value.length > 30) return "角色名称不能超过 30 个字符";
  if (value.toLowerCase() === "fanto" || roles.some(role => role.nickname.toLowerCase() === value.toLowerCase()))
    return "角色名称已存在，请使用其他名称";
  return null;
}

export const fantoLabel = (role: Pick<FantoSettings, "nickname"> | null) => role ? role.nickname.trim() || "未命名角色" : "fanto";
