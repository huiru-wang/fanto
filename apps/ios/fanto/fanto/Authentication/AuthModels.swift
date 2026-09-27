import Foundation

nonisolated struct AuthUser: Codable, Equatable, Sendable {
    let userId: String
    let status: String
}

nonisolated struct AuthResult: Decodable, Sendable {
    let user: AuthUser
    let accessToken: String
    let accessTokenExpiresAt: String
    let refreshToken: String
    let refreshTokenExpiresAt: String
}

nonisolated struct AuthIntent: Decodable, Sendable {
    nonisolated struct Challenge: Decodable, Sendable {
        let nonce: String
    }

    let intentId: String
    let provider: String
    let expiresAt: String
    let challenge: Challenge

    var nonce: String { challenge.nonce }
}

nonisolated struct StoredAuthSession: Codable, Sendable {
    let user: AuthUser
    let accessToken: String
    let accessTokenExpiresAt: Date
    let refreshToken: String
    let refreshTokenExpiresAt: Date
}

nonisolated enum AuthenticationError: LocalizedError, Equatable, Sendable {
    case configuration(String)
    case cancelled
    case accountUnavailable
    case expired
    case network
    case server(String)

    var errorDescription: String? {
        switch self {
        case let .configuration(message): message
        case .cancelled: nil
        case .accountUnavailable: "这个账号当前不可用。"
        case .expired: "登录状态已过期，请重新登录。"
        case .network: "网络连接失败，请检查网络后重试。"
        case let .server(message): message
        }
    }
}
