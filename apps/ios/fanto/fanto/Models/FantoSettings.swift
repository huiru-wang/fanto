import Foundation

nonisolated struct FantoSettings: Codable, Equatable, Sendable {
    var nickname = "Fanto"
    var description = ""
    var avatarMediaId: String?
    var roleConfig = CharacterPrompt()
    var version = 0
    var createdAt: Date?
    var updatedAt: Date?

    func textChanges(from base: Self) -> FantoSettingsChanges {
        var changes = FantoSettingsChanges()
        if nickname != base.nickname { changes.nickname = nickname }
        if description != base.description { changes.description = description }
        var role: [String: String] = [:]
        for key in CharacterPrompt.fields where roleConfig[key] != base.roleConfig[key] { role[key] = roleConfig[key] }
        if !role.isEmpty { changes.roleConfig = role }
        return changes
    }
}

nonisolated struct FantoSettingsChanges: Encodable {
    var nickname: String?
    var description: String?
    var roleConfig: [String: String]?
    var updatesAvatar = false
    var avatarMediaId: String?
    var isEmpty: Bool { nickname == nil && description == nil && roleConfig == nil && !updatesAvatar }
    private enum CodingKeys: String, CodingKey { case nickname, description, roleConfig, avatarMediaId }
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(nickname, forKey: .nickname)
        try container.encodeIfPresent(description, forKey: .description)
        try container.encodeIfPresent(roleConfig, forKey: .roleConfig)
        if updatesAvatar {
            if let avatarMediaId { try container.encode(avatarMediaId, forKey: .avatarMediaId) }
            else { try container.encodeNil(forKey: .avatarMediaId) }
        }
    }
}

extension CharacterPrompt {
    static let fields = ["character", "scenario", "instructions", "exampleDialogues"]
    subscript(key: String) -> String {
        get { switch key { case "character": character; case "scenario": scenario; case "instructions": instructions; case "exampleDialogues": exampleDialogues; default: "" } }
        set { switch key { case "character": character = newValue; case "scenario": scenario = newValue; case "instructions": instructions = newValue; case "exampleDialogues": exampleDialogues = newValue; default: break } }
    }
}
