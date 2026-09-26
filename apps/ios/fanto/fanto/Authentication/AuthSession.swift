import Foundation

extension Notification.Name {
    nonisolated static let fantoAuthSessionInvalidated = Notification.Name("fanto.auth.session.invalidated")
}

actor AuthSession {
    static let shared = AuthSession()

    private let store = AuthCredentialStore()
    private var cached: StoredAuthSession?
    private var refreshTask: Task<StoredAuthSession, Error>?

    func restore() async throws -> AuthUser? {
        guard let session = try store.load() else { return nil }
        cached = session
        if session.refreshTokenExpiresAt <= .now {
            try store.clear()
            cached = nil
            throw AuthenticationError.expired
        }
        if session.accessTokenExpiresAt > Date.now.addingTimeInterval(60) {
            return session.user
        }
        return try await refresh().user
    }

    func install(_ result: AuthResult) throws -> AuthUser {
        let session = try Self.session(from: result)
        try store.save(session)
        cached = session
        return session.user
    }

    func accessToken() async throws -> String {
        if cached == nil { cached = try store.load() }
        guard let session = cached else { throw AuthenticationError.expired }
        if session.accessTokenExpiresAt > Date.now.addingTimeInterval(60) { return session.accessToken }
        return try await refresh().accessToken
    }

    func forceRefresh() async throws -> String {
        try await refresh().accessToken
    }

    private func refresh() async throws -> StoredAuthSession {
        if let refreshTask { return try await refreshTask.value }
        if cached == nil { cached = try store.load() }
        guard let current = cached, current.refreshTokenExpiresAt > .now else {
            try? store.clear()
            cached = nil
            throw AuthenticationError.expired
        }

        let task = Task<StoredAuthSession, Error> {
            let result = try await AuthAPIClient.shared.refresh(current.refreshToken)
            return try Self.session(from: result)
        }
        refreshTask = task
        defer { refreshTask = nil }
        do {
            let updated = try await task.value
            try store.save(updated)
            cached = updated
            return updated
        } catch {
            if let authError = error as? AuthenticationError, authError == .expired || authError == .accountUnavailable {
                try? store.clear()
                cached = nil
                NotificationCenter.default.post(name: .fantoAuthSessionInvalidated, object: nil)
            }
            throw error
        }
    }

    private static func session(from result: AuthResult) throws -> StoredAuthSession {
        guard let accessExpiry = parse(result.accessTokenExpiresAt), let refreshExpiry = parse(result.refreshTokenExpiresAt) else {
            throw AuthenticationError.server("登录凭证时间格式无效。")
        }
        return StoredAuthSession(
            user: result.user,
            accessToken: result.accessToken,
            accessTokenExpiresAt: accessExpiry,
            refreshToken: result.refreshToken,
            refreshTokenExpiresAt: refreshExpiry
        )
    }

    private static func parse(_ value: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }
}
