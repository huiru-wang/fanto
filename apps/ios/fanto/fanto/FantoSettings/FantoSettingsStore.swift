import SwiftUI
import Observation

@MainActor @Observable
final class FantoSettingsStore {
    private(set) var settings: FantoSettings?
    private(set) var isLoading = false
    private(set) var errorMessage: String?
    func accept(_ value: FantoSettings) {
        if settings == nil || value.version >= settings!.version { settings = value }
    }
    func load() async {
        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false }
        do { accept(try await FantoAPIClient.shared.fetchFantoSettings()); errorMessage = nil }
        catch { if !Task.isCancelled { errorMessage = error.localizedDescription } }
    }
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
