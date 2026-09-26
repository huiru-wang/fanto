import Foundation

nonisolated enum AuthenticationMode: Hashable, Sendable {
    case signIn
    case register

    var navigationTitle: String { self == .signIn ? "登录" : "创建账号" }
    var heading: String { self == .signIn ? "欢迎回来" : "开始使用 Fanto" }
    var detail: String {
        self == .signIn
            ? "登录后，你的记录、脉络和与 Fanto 的对话会在设备间保持一致。"
            : "创建账号后，你的记录会安全地归属于同一个 Fanto 身份。"
    }
    var googleTitle: String { self == .signIn ? "使用 Google 登录" : "使用 Google 创建账号" }
}

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
    case notRegistered
    case alreadyRegistered
    case accountUnavailable
    case expired
    case network
    case server(String)

    var errorDescription: String? {
        switch self {
        case let .configuration(message): message
        case .cancelled: nil
        case .notRegistered: "这个 Google 账号还没有创建 Fanto 账号。"
        case .alreadyRegistered: "这个 Google 账号已经注册，可以直接登录。"
        case .accountUnavailable: "这个账号当前不可用。"
        case .expired: "登录状态已过期，请重新登录。"
        case .network: "网络连接失败，请检查网络后重试。"
        case let .server(message): message
        }
    }
}
