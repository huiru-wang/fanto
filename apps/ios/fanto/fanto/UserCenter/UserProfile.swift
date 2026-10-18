import SwiftUI
import Observation

@MainActor @Observable
final class UserProfileStore {
    private let resource: CachedResource<UserProfile>
    private let accountResource: CachedResource<AccountInfo>
    var profile: UserProfile? { resource.value }
    var isSaving: Bool { resource.isUpdating }
    func save(_ field: UserProfileField, value: String?, original: String?) async throws {
        try await resource.update(original: original, desired: value, field: { field.value(in: $0) }) { current in
            try await FantoAPIClient.shared.updateUserProfile(version: current.version, changes: .init(field: field, value: value))
        }
    }
    var isLoading: Bool { resource.isLoading }
    var error: String? { resource.error }
    var account: AccountInfo? { accountResource.value }
    var isLoadingAccount: Bool { accountResource.isLoading }
    var accountError: String? { accountResource.error }
    init() {
        let scope = AccountCache.shared.scope
        resource = CachedResource(key: "user-profile", scope: scope, version: { $0.version },
            isCurrent: { scope != nil && AccountCache.shared.scope == scope },
            fetch: { try await FantoAPIClient.shared.fetchUserProfile() })
        accountResource = CachedResource(key: "account-info", scope: scope, version: { _ in 0 },
            isCurrent: { scope != nil && AccountCache.shared.scope == scope },
            fetch: { try await FantoAPIClient.shared.fetchAccountInfo() })
    }
    func accept(_ value: UserProfile) { resource.accept(value) }
    func restore() async {
        await resource.restore()
        await accountResource.restore()
    }
    func load(force: Bool = false) async { await resource.load(force: force) }
    func loadAccount(force: Bool = false) async { await accountResource.load(force: force) }
}
private struct UserProfileKey: EnvironmentKey { static let defaultValue: UserProfileStore? = nil }
extension EnvironmentValues {
    var userProfile: UserProfileStore? {
        get { self[UserProfileKey.self] }
        set { self[UserProfileKey.self] = newValue }
    }
}
