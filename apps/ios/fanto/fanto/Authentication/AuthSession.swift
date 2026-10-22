import Foundation

extension Notification.Name {
    nonisolated static let fantoAuthSessionInvalidated = Notification.Name("fanto.auth.session.invalidated")
}

actor AuthSession {
    static let shared = AuthSession()
    private let store = AuthCredentialStore()
    private var cached: StoredAuthSession?
    private var signingOut = false

    func restore() async throws -> AuthUser? {
        guard let session = try store.load() else { return nil }
        cached = session
        guard session.absoluteExpiresAt > .now else {
            try store.clear(); cached = nil
            throw AuthenticationError.expired
        }
        do { return try await AuthAPIClient.shared.me(token: session.sessionToken) }
        catch let error as AuthenticationError {
            if error == .expired || error == .accountUnavailable { invalidate() }
            throw error
        }
    }

    func signOut() async throws {
        signingOut = true
        guard let token = try store.load()?.sessionToken else { try store.clear(); cached = nil; signingOut = false; return }
        try await AuthAPIClient.shared.logout(token: token)
        try store.clear()
        cached = nil
        signingOut = false
    }

    func install(_ result: AuthResult) throws -> AuthUser {
        guard let expires = Self.parse(result.absoluteExpiresAt), expires > .now else {
            throw AuthenticationError.server("登录凭证时间格式无效。")
        }
        let session = StoredAuthSession(user: result.user, sessionToken: result.sessionToken, absoluteExpiresAt: expires)
        try store.save(session)
        cached = session
        signingOut = false
        return result.user
    }

    func sessionToken() throws -> String {
        if signingOut { throw AuthenticationError.server("退出登录尚未完成，请重试。") }
        if cached == nil { cached = try store.load() }
        guard let session = cached, session.absoluteExpiresAt > .now else { throw AuthenticationError.expired }
        return session.sessionToken
    }

    func invalidate() {
        try? store.clear()
        cached = nil
        NotificationCenter.default.post(name: .fantoAuthSessionInvalidated, object: nil)
    }

    private static func parse(_ value: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }
}
