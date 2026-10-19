import SwiftUI
import Observation

@MainActor @Observable
final class FantoSettingsStore {
    private let resource: CachedResource<FantoSettings>
    var settings: FantoSettings? { resource.value }
    var isSaving: Bool { resource.isUpdating }
    func saveText(field: String, value: String, original: String) async throws {
        guard field == "nickname" || CharacterPrompt.fields.contains(field) else { throw FantoAPIError.invalidResponse }
        var changes = FantoSettingsChanges()
        if field == "nickname" { changes.nickname = value }
        else { changes.roleConfig = [field: value] }
        try await resource.update(original: original, desired: value,
            field: { field == "nickname" ? $0.nickname : $0.roleConfig[field] }) { current in
            try await FantoAPIClient.shared.updateFantoSettings(version: current.version, changes: changes)
        }
    }
    func saveAvatar(_ id: String, original: String?) async throws {
        var changes = FantoSettingsChanges()
        changes.updatesAvatar = true; changes.avatarMediaId = id
        try await resource.update(original: original, desired: id, field: { $0.avatarMediaId }) { current in
            try await FantoAPIClient.shared.updateFantoSettings(version: current.version, changes: changes)
        }
    }
    func selectSession(_ id: String, original: String?) async throws {
        var changes = FantoSettingsChanges()
        changes.sessionId = id
        try await resource.update(original: original, desired: id, field: { $0.sessionId }) { current in
            try await FantoAPIClient.shared.updateFantoSettings(version: current.version, changes: changes)
        }
    }
    var isLoading: Bool { resource.isLoading }
    var errorMessage: String? { resource.error }
    init() {
        let scope = AccountCache.shared.scope
        resource = CachedResource(key: "fanto-settings", scope: scope, version: { $0.version },
            isCurrent: { scope != nil && AccountCache.shared.scope == scope },
            fetch: { try await FantoAPIClient.shared.fetchFantoSettings() })
    }
    func accept(_ value: FantoSettings) { resource.accept(value) }
    func restore() async { await resource.restore() }
    func load(force: Bool = false) async { await resource.load(force: force) }
}

private struct FantoProfileKey: EnvironmentKey {
    static let defaultValue: FantoSettingsStore? = nil
}
extension EnvironmentValues {
    var fantoProfile: FantoSettingsStore? {
        get { self[FantoProfileKey.self] }
        set { self[FantoProfileKey.self] = newValue }
    }
}
