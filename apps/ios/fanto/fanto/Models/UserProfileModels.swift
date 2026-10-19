import Foundation

nonisolated struct UserProfile: Codable, Equatable, Sendable {
    var nickname: String
    var signature: String
    var coverMediaId: String?
    var avatarMediaId: String?
    var version: Int
    var joinedAt: Date
}
nonisolated enum UserProfileField: String {
    case nickname, signature, avatarMediaId, coverMediaId
    func value(in profile: UserProfile) -> String? {
        switch self {
        case .nickname: profile.nickname
        case .signature: profile.signature
        case .avatarMediaId: profile.avatarMediaId
        case .coverMediaId: profile.coverMediaId
        }
    }
}
nonisolated struct UserProfileChanges: Encodable {
    let field: UserProfileField
    let value: String?
    private struct Key: CodingKey {
        let stringValue: String
        var intValue: Int? { nil }
        init(_ value: String) { stringValue = value }
        init?(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { return nil }
    }
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: Key.self)
        let key = Key(field.rawValue)
        if let value { try container.encode(value, forKey: key) }
        else { try container.encodeNil(forKey: key) }
    }
}
nonisolated struct AccountInfo: Codable, Sendable {
    let userId: String
    let identities: [Identity]
    struct Identity: Codable, Sendable, Identifiable {
        var id: String { identityId }
        let identityId: String
        let provider: String
        let displayHint: String?
        var title: String { switch provider { case "apple": "Apple"; case "google": "Google"; case "phone": "手机号"; default: provider } }
    }
}

nonisolated struct UserStatistics: Codable, Sendable {
    let companionDays: Int
    let recordCount: Int
    let intimacy: Int
    let intimacyIsPlaceholder: Bool
    let asOf: Date
}
