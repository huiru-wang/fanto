import SwiftUI
import Observation

nonisolated struct UserProfile: Codable, Equatable, Sendable {
    var nickname: String
    var signature: String
    var avatarMediaId: String?
    var version: Int
    var joinedAt: Date
}
nonisolated struct UserProfileChanges: Encodable {
    let nickname: String
    let signature: String
    let avatarMediaId: String?
    enum CodingKeys: String, CodingKey { case nickname, signature, avatarMediaId }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(nickname, forKey: .nickname)
        try c.encode(signature, forKey: .signature)
        if let avatarMediaId { try c.encode(avatarMediaId, forKey: .avatarMediaId) }
        else { try c.encodeNil(forKey: .avatarMediaId) }
    }
}
nonisolated struct AccountInfo: Decodable {
    let userId: String
    let identities: [Identity]
    struct Identity: Decodable, Identifiable {
        var id: String { identityId }
        let identityId: String
        let provider: String
        let displayHint: String?
        var title: String { switch provider { case "apple": "Apple"; case "google": "Google"; case "phone": "手机号"; default: provider } }
    }
}
@MainActor @Observable
final class UserProfileStore {
    var editDraft: (base: UserProfile, value: UserProfile)?
    private(set) var profile: UserProfile?
    private(set) var isLoading = false
    private(set) var error: String?
    func accept(_ value: UserProfile) { if profile == nil || value.version >= profile!.version { profile = value }; error = nil }
    func load() async {
        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false }
        do { let value = try await FantoAPIClient.shared.fetchUserProfile(); try Task.checkCancellation(); accept(value) }
        catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    }
}
private struct UserProfileKey: EnvironmentKey { static let defaultValue: UserProfileStore? = nil }
extension EnvironmentValues {
    var userProfile: UserProfileStore? {
        get { self[UserProfileKey.self] }
        set { self[UserProfileKey.self] = newValue }
    }
}
