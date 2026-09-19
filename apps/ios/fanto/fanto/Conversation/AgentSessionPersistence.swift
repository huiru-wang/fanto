import Foundation
import Security

enum AgentSessionPersistenceError: LocalizedError {
    case unexpectedStatus(OSStatus)

    var errorDescription: String? {
        "无法保存对话状态。"
    }
}

struct AgentSessionPersistence {
    private let service = "com.robinverse.fanto.agent-session"

    func load(userID: String, agentID: String) throws -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account(userID: userID, agentID: agentID),
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data, let value = String(data: data, encoding: .utf8) else {
            throw AgentSessionPersistenceError.unexpectedStatus(status)
        }
        return value
    }

    func save(_ sessionID: String, userID: String, agentID: String) throws {
        let key: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account(userID: userID, agentID: agentID),
        ]
        let value: [String: Any] = [kSecValueData as String: Data(sessionID.utf8)]
        let status = SecItemUpdate(key as CFDictionary, value as CFDictionary)
        if status == errSecSuccess { return }
        if status != errSecItemNotFound { throw AgentSessionPersistenceError.unexpectedStatus(status) }

        var item = key
        value.forEach { item[$0.key] = $0.value }
        let addStatus = SecItemAdd(item as CFDictionary, nil)
        guard addStatus == errSecSuccess else { throw AgentSessionPersistenceError.unexpectedStatus(addStatus) }
    }

    func clear(userID: String, agentID: String) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account(userID: userID, agentID: agentID),
        ]
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw AgentSessionPersistenceError.unexpectedStatus(status)
        }
    }

    private func account(userID: String, agentID: String) -> String {
        "\(userID).\(agentID)"
    }
}
