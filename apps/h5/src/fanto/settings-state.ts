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

export function usableSelection(selectedId: string | null, roles: FantoSettings[]): string | null {
  return roles.some(role => role.fantoId === selectedId && role.status === "active") ? selectedId : null;
}

export const fantoLabel = (role: Pick<FantoSettings, "nickname"> | null) => role ? role.nickname.trim() || "未命名角色" : "默认 Main";
