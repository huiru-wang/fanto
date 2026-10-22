import Foundation

nonisolated struct AuthAPIClient {
    static let shared = AuthAPIClient()
    private let baseURL = URL(string: "https://fanto.robinverse.me")!

    func createGoogleAuthenticationIntent() async throws -> AuthIntent {
        try await createAuthenticationIntent(provider: "google")
    }

    func createAppleAuthenticationIntent() async throws -> AuthIntent {
        try await createAuthenticationIntent(provider: "apple")
    }

    func authenticateGoogle(intentID: String, idToken: String) async throws -> AuthResult {
        try await authenticate(intentID: intentID, idToken: idToken)
    }

    func authenticateApple(intentID: String, idToken: String) async throws -> AuthResult {
        try await authenticate(intentID: intentID, idToken: idToken)
    }

    private func createAuthenticationIntent(provider: String) async throws -> AuthIntent {
        try await post(
            path: "api/auth/intents",
            body: IntentRequest(
                purpose: "authenticate",
                provider: provider
            )
        )
    }

    private func authenticate(intentID: String, idToken: String) async throws -> AuthResult {
        try await post(
            path: "api/auth/native/authentications",
            body: ProofRequest(
                intentId: intentID,
                proof: ProviderProof(idToken: idToken)
            )
        )
    }

    func me(token: String) async throws -> AuthUser {
        var request = URLRequest(url: baseURL.appending(path: "api/users/me"), cachePolicy: .reloadIgnoringLocalCacheData)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw AuthenticationError.server("服务返回异常。") }
            if http.statusCode == 401 { throw AuthenticationError.expired }
            if http.statusCode == 403 { throw AuthenticationError.accountUnavailable }
            guard (200...299).contains(http.statusCode) else { throw AuthenticationError.server("无法恢复登录状态。") }
            let envelope = try JSONDecoder().decode(AuthEnvelope<AuthUser>.self, from: data)
            guard envelope.success, let user = envelope.result else { throw AuthenticationError.server("无法恢复登录状态。") }
            return user
        } catch let error as AuthenticationError { throw error }
        catch is URLError { throw AuthenticationError.network }
        catch { throw AuthenticationError.server("服务返回的数据无法识别。") }
    }

    func logout(token: String) async throws {
        var request = URLRequest(url: baseURL.appending(path: "api/auth/native/logout"))
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, http.statusCode == 204 else {
                throw AuthenticationError.server("服务端退出失败，请重试。")
            }
        } catch let error as AuthenticationError { throw error }
        catch is URLError { throw AuthenticationError.network }
    }

    private func post<Response: Decodable, Body: Encodable>(path: String, body: Body) async throws -> Response {
        var request = URLRequest(url: baseURL.appending(path: path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw AuthenticationError.server("服务返回异常。") }
            let envelope = try JSONDecoder().decode(AuthEnvelope<Response>.self, from: data)
            guard (200 ... 299).contains(http.statusCode), envelope.success, let result = envelope.result else {
                throw map(code: envelope.errorCode, message: envelope.errorMsg, status: http.statusCode)
            }
            return result
        } catch let error as AuthenticationError {
            throw error
        } catch is URLError {
            throw AuthenticationError.network
        } catch {
            throw AuthenticationError.server("服务返回的数据无法识别。")
        }
    }

    private func map(code: String?, message: String?, status: Int) -> AuthenticationError {
        switch code {
        case "USER_DISABLED": .accountUnavailable
        case "UNAUTHENTICATED": .expired
        default: .server(message ?? "登录失败（\(status)）。")
        }
    }
}

private struct AuthEnvelope<Result: Decodable>: Decodable {
    let success: Bool
    let result: Result?
    let errorCode: String?
    let errorMsg: String?
}

private struct IntentRequest: Encodable {
    let purpose: String
    let provider: String
}

private struct ProviderProof: Encodable {
    let idToken: String
}

private struct ProofRequest: Encodable {
    let intentId: String
    let proof: ProviderProof
}
