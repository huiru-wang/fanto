import type { FantoSettings, SettingsChanges, RoleConfig } from "../api/fanto";
export function textChanges(base: FantoSettings, draft: FantoSettings): SettingsChanges {
    const changes: SettingsChanges = {};
    for (const key of ["nickname", "description"] as const)
        if (base[key] !== draft[key])
            changes[key] = draft[key];
    const role: Partial<RoleConfig> = {};
    for (const key of Object.keys(base.roleConfig) as (keyof RoleConfig)[])
        if (draft.roleConfig[key] !== base.roleConfig[key])
            role[key] = draft.roleConfig[key];
    if (Object.keys(role).length)
        changes.roleConfig = role;
    return changes;
}
// Preserve local edits after an avatar-only write; don't silently overwrite remote text changes.
export function rebaseText(base: FantoSettings, draft: FantoSettings, remote: FantoSettings) {
    const changes = textChanges(base, draft), conflicts: string[] = [];
    for (const key of ["nickname", "description"] as const)
        if (changes[key] !== undefined && remote[key] !== base[key] && remote[key] !== draft[key])
            conflicts.push(key);
    for (const key of Object.keys(changes.roleConfig ?? {}) as (keyof RoleConfig)[])
        if (remote.roleConfig[key] !== base.roleConfig[key] && remote.roleConfig[key] !== draft.roleConfig[key])
            conflicts.push(key);
    return { draft: { ...remote, ...changes, roleConfig: { ...remote.roleConfig, ...changes.roleConfig } }, conflicts };
}
