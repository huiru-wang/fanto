import Foundation

enum AgentAPIError: LocalizedError {
    case invalidResponse
    case httpStatus(Int)
    case server(String)

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            "服务返回的数据无法识别。"
        case let .httpStatus(status):
            "服务暂时不可用（\(status)）。"
        case let .server(message):
            message
        }
    }

    var invalidatesSession: Bool {
        if case let .httpStatus(status) = self {
            return status == 403 || status == 404
        }
        return false
    }
}

struct AgentHistoryMessage: Identifiable {
    let id: String
    let role: ConversationRole
    let text: String
}

enum AgentStreamEvent {
    case processing
    case delta(String)
    case done
    case failure(String)
}

struct AgentAPIClient {
    static let shared = AgentAPIClient()

    let userID = "creation-demo-user"
    let agentID = "main"

    private let baseURL = URL(string: "http://47.118.26.9")!
    private let agentToken = "a3f2b8c1d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9"

    func createSession() async throws -> String {
        let body = CreateSessionRequest(agentID: agentID)
        let response: CreateSessionResponse = try await request(path: "api/agent/sessions", method: "POST", body: body)
        return response.sessionID
    }

    func fetchHistory(sessionID: String) async throws -> [AgentHistoryMessage] {
        var components = URLComponents(url: baseURL.appending(path: "api/agent/sessions/\(sessionID)/history"), resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "limit", value: "10")]
        guard let url = components?.url else { throw AgentAPIError.invalidResponse }
        let response: HistoryResponse = try await request(url: url)
        return response.data.compactMap { entry in
            guard let role = ConversationRole(rawValue: entry.message.role), !entry.message.content.isEmpty else { return nil }
            return AgentHistoryMessage(id: entry.id, role: role, text: entry.message.content)
        }.reversed()
    }

    func stream(sessionID: String, message: String, onEvent: @escaping (AgentStreamEvent) -> Void) async throws {
        let body = StreamRequest(agentID: agentID, sessionID: sessionID, message: message)
        var request = try makeRequest(path: "api/agent/stream", method: "POST", body: body)
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")

        let (bytes, response) = try await URLSession.shared.bytes(for: request)
        guard let http = response as? HTTPURLResponse else { throw AgentAPIError.invalidResponse }
        guard (200 ... 299).contains(http.statusCode) else { throw AgentAPIError.httpStatus(http.statusCode) }

        var eventName: String?
        var dataLines: [String] = []
        for try await line in bytes.lines {
            try Task.checkCancellation()
            if line.isEmpty {
                deliver(eventName: eventName, data: dataLines.joined(separator: "\n"), onEvent: onEvent)
                eventName = nil
                dataLines.removeAll(keepingCapacity: true)
            } else if line.hasPrefix("event:") {
                eventName = String(line.dropFirst(6)).trimmingCharacters(in: .whitespaces)
            } else if line.hasPrefix("data:") {
                dataLines.append(String(line.dropFirst(5)).trimmingCharacters(in: .whitespaces))
            }
        }

        deliver(eventName: eventName, data: dataLines.joined(separator: "\n"), onEvent: onEvent)
    }

    private func deliver(eventName: String?, data: String, onEvent: (AgentStreamEvent) -> Void) {
        switch eventName {
        case "turn_start", "tool_start":
            onEvent(.processing)
        case "delta":
            guard let payload = try? JSONDecoder().decode(StreamDelta.self, from: Data(data.utf8)) else { return }
            onEvent(.delta(payload.text))
        case "done":
            onEvent(.done)
        case "error":
            let payload = try? JSONDecoder().decode(StreamFailure.self, from: Data(data.utf8))
            onEvent(.failure(payload?.error ?? "这次回复没有完成。"))
        default:
            break
        }
    }

    private func request<Response: Decodable, Body: Encodable>(path: String, method: String, body: Body) async throws -> Response {
        try await request(url: baseURL.appending(path: path), method: method, body: body)
    }

    private func request<Response: Decodable>(url: URL) async throws -> Response {
        try await request(url: url, method: "GET", body: Optional<String>.none)
    }

    private func request<Response: Decodable, Body: Encodable>(url: URL, method: String, body: Body?) async throws -> Response {
        let request = try makeRequest(url: url, method: method, body: body)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw AgentAPIError.invalidResponse }
        guard (200 ... 299).contains(http.statusCode) else { throw AgentAPIError.httpStatus(http.statusCode) }
        let envelope = try JSONDecoder().decode(AgentEnvelope<Response>.self, from: data)
        guard envelope.success, let result = envelope.result else {
            throw AgentAPIError.server(envelope.error ?? "服务暂时不可用。")
        }
        return result
    }

    private func makeRequest<Body: Encodable>(path: String, method: String, body: Body) throws -> URLRequest {
        try makeRequest(url: baseURL.appending(path: path), method: method, body: body)
    }

    private func makeRequest<Body: Encodable>(url: URL, method: String, body: Body?) throws -> URLRequest {
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(agentToken)", forHTTPHeaderField: "Authorization")
        request.setValue(userID, forHTTPHeaderField: "X-User-Id")
        request.setValue(UUID().uuidString, forHTTPHeaderField: "X-Trace-Id")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let body {
            request.httpBody = try JSONEncoder().encode(body)
        }
        return request
    }
}

private struct AgentEnvelope<Result: Decodable>: Decodable {
    let success: Bool
    let result: Result?
    let error: String?
}

private struct CreateSessionRequest: Encodable {
    let agentID: String

    enum CodingKeys: String, CodingKey { case agentID = "agentId" }
}

private struct StreamRequest: Encodable {
    let agentID: String
    let sessionID: String
    let message: String

    enum CodingKeys: String, CodingKey {
        case agentID = "agentId"
        case sessionID = "sessionId"
        case message
    }
}

private struct CreateSessionResponse: Decodable {
    let sessionID: String

    enum CodingKeys: String, CodingKey { case sessionID = "sessionId" }
}

private struct HistoryResponse: Decodable {
    let data: [HistoryEntry]
}

private struct HistoryEntry: Decodable {
    let id: String
    let message: HistoryEntryMessage
}

private struct HistoryEntryMessage: Decodable {
    let role: String
    let content: String
}

private struct StreamDelta: Decodable { let text: String }
private struct StreamFailure: Decodable { let error: String }
