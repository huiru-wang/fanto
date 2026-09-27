import Foundation

nonisolated struct AuthAPIClient {
    static let shared = AuthAPIClient()
    private let baseURL = URL(string: "https://fanto.robinverse.me")!

    func createGoogleAuthenticationIntent() async throws -> AuthIntent {
        try await post(
            path: "api/auth/intents",
            body: IntentRequest(
                purpose: "authenticate",
                provider: "google"
            )
        )
    }

    func authenticateGoogle(intentID: String, idToken: String) async throws -> AuthResult {
        return try await post(
            path: "api/auth/authentications",
            body: ProofRequest(
                intentId: intentID,
                proof: ProviderProof(idToken: idToken)
            )
        )
    }

    func refresh(_ refreshToken: String) async throws -> AuthResult {
        try await post(path: "api/auth/tokens/refresh", body: RefreshRequest(refreshToken: refreshToken))
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
        case "REFRESH_TOKEN_INVALID", "UNAUTHENTICATED": .expired
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
private struct RefreshRequest: Encodable { let refreshToken: String }
