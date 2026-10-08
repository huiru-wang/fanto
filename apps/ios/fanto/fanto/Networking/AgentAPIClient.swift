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

enum PresentedMediaType: String, Decodable, Hashable {
    case image
    case audio
}

struct PresentedMedia: Identifiable, Decodable, Hashable {
    let mediaID: String
    let mediaType: PresentedMediaType
    let mimeType: String
    let width: Int?
    let height: Int?
    let durationMS: Int?

    var id: String { mediaID }

    enum CodingKeys: String, CodingKey {
        case mediaID = "mediaId"
        case mediaType, mimeType, width, height
        case durationMS = "durationMs"
    }
}

struct AgentHistoryMessage: Identifiable {
    let id: String
    let role: ConversationRole
    let text: String
    let media: [PresentedMedia]
    let activities: [ConversationToolActivity]
    let tasks: [FantoTaskSummary]
    let userInputRequest: FantoUserInputRequest?
    let userInputResponse: FantoUserInputResponse?
}

struct AgentHistoryPage {
    let messages: [AgentHistoryMessage]
    let hasMore: Bool
    let nextCursor: Int?
}

enum AgentStreamEvent {
    case processing(String)
    case delta(String)
    case presentation([PresentedMedia])
    case toolActivity(ConversationToolActivity)
    case taskCreated(FantoTaskSummary)
    case userInputRequested(FantoUserInputRequest)
    case done
    case failure(String)
}

struct AgentAPIClient {
    static let shared = AgentAPIClient()

    var userID: String { AuthCredentialStore().currentUserID() ?? "signed-out" }
    let agentID = "main"

    private let baseURL = URL(string: "https://fanto.robinverse.me")!

    func createSession() async throws -> String {
        let body = CreateSessionRequest(agentID: agentID)
        let response: CreateSessionResponse = try await request(path: "api/agent/sessions", method: "POST", body: body)
        return response.sessionID
    }

    func fetchHistory(sessionID: String, cursor: Int? = nil, projectID: String? = nil) async throws -> AgentHistoryPage {
        var components = URLComponents(url: baseURL.appending(path: projectID.map { "api/projects/\($0)/session/history" } ?? "api/agent/sessions/\(sessionID)/history"), resolvingAgainstBaseURL: false)
        var queryItems = [URLQueryItem(name: "limit", value: "10")]
        if let cursor {
            queryItems.append(URLQueryItem(name: "cursor", value: String(cursor)))
        }
        components?.queryItems = queryItems
        guard let url = components?.url else { throw AgentAPIError.invalidResponse }
        let response: HistoryResponse = try await request(url: url)
        return .init(
            messages: projectHistory(response.messages),
            hasMore: response.hasMore,
            nextCursor: response.nextCursor
        )
    }

    func fetchTaskDetails(taskID: String) async throws -> FantoTaskDetails {
        let response: TaskDetailResponse = try await request(path: "api/tasks/\(taskID)", method: "GET")
        let runs: TaskRunsResponse? = try? await request(path: "api/tasks/\(taskID)/runs", method: "GET")
        return FantoTaskDetails(task: response.task, runs: runs?.data ?? [])
    }

    func fetchTaskArtifactPreview(mediaID: String) async throws -> FantoTaskArtifactPreview {
        try await request(path: "api/tasks/artifacts/\(mediaID)/preview", method: "GET")
    }

    func observeProject(projectID: String, onEvent: @escaping (AgentStreamEvent) -> Void) async throws {
        var request = try await makeRequest(url: baseURL.appending(path: "api/projects/\(projectID)/session/events"), method: "GET")
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        let (bytes, response) = try await URLSession.shared.bytes(for: request)
        guard let http = response as? HTTPURLResponse, (200 ... 299).contains(http.statusCode) else {
            throw AgentAPIError.invalidResponse
        }
        var eventName: String?
        var dataLines: [String] = []
        var lineBytes: [UInt8] = []
        func consume(_ line: String) {
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
        for try await byte in bytes {
            try Task.checkCancellation()
            if byte == 0x0A {
                var line = String(decoding: lineBytes, as: UTF8.self)
                if line.last == "\r" { line.removeLast() }
                consume(line)
                lineBytes.removeAll(keepingCapacity: true)
            } else { lineBytes.append(byte) }
        }
        if !lineBytes.isEmpty { consume(String(decoding: lineBytes, as: UTF8.self)) }
    }

    func stream(sessionID: String, message: String, projectID: String? = nil, onEvent: @escaping (AgentStreamEvent) -> Void) async throws {
        var request: URLRequest
        if let projectID {
            request = try await makeRequest(path: "api/projects/\(projectID)/session/stream", method: "POST", body: ["message": message])
        } else {
            let body = StreamRequest(agentID: agentID, sessionID: sessionID, message: message)
            request = try await makeRequest(path: "api/agent/stream", method: "POST", body: body)
        }
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")

        let (bytes, response) = try await URLSession.shared.bytes(for: request)
        guard let http = response as? HTTPURLResponse else { throw AgentAPIError.invalidResponse }
        guard (200 ... 299).contains(http.statusCode) else { throw AgentAPIError.httpStatus(http.statusCode) }

        var eventName: String?
        var dataLines: [String] = []
        var lineBytes: [UInt8] = []

        func consume(line: String) {
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

        for try await byte in bytes {
            try Task.checkCancellation()
            if byte == 0x0A {
                var line = String(decoding: lineBytes, as: UTF8.self)
                if line.last == "\r" { line.removeLast() }
                consume(line: line)
                lineBytes.removeAll(keepingCapacity: true)
            } else {
                lineBytes.append(byte)
            }
        }

        if !lineBytes.isEmpty {
            consume(line: String(decoding: lineBytes, as: UTF8.self))
        }
        deliver(eventName: eventName, data: dataLines.joined(separator: "\n"), onEvent: onEvent)
    }

    private func deliver(eventName: String?, data: String, onEvent: (AgentStreamEvent) -> Void) {
        switch eventName {
        case "turn_start":
            onEvent(.processing("Fanto 正在思考…"))
        case "message_start":
            onEvent(.processing("正在组织回复…"))
        case "tool_start":
            guard let payload = try? JSONDecoder().decode(StreamToolEvent.self, from: Data(data.utf8)),
                  payload.presentation.visible
            else { return }
            onEvent(.toolActivity(.init(
                id: payload.toolCallID,
                text: payload.presentation.displayContent,
                animation: payload.presentation.animation,
                state: .inProgress
            )))
        case "delta":
            guard let payload = try? JSONDecoder().decode(StreamDelta.self, from: Data(data.utf8)) else { return }
            onEvent(.delta(payload.text))
        case "tool_end":
            guard let payload = try? JSONDecoder().decode(StreamToolEvent.self, from: Data(data.utf8)) else { return }
            if payload.presentation.visible {
                onEvent(.toolActivity(.init(
                    id: payload.toolCallID,
                    text: payload.presentation.displayContent,
                    animation: payload.presentation.animation,
                    state: payload.status == "succeeded" ? .succeeded : .failed
                )))
            }
            guard payload.status == "succeeded" else { return }
            if let items = payload.result?.items, !items.isEmpty {
                onEvent(.presentation(items))
            }
            if let task = payload.result?.task {
                onEvent(.taskCreated(task))
            }
            if let request = payload.result?.userInputRequest {
                onEvent(.userInputRequested(request))
            }
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

    private func request<Response: Decodable>(path: String, method: String) async throws -> Response {
        try await request(url: baseURL.appending(path: path), method: method)
    }

    private func request<Response: Decodable>(url: URL) async throws -> Response {
        try await request(url: url, method: "GET")
    }

    private func request<Response: Decodable>(url: URL, method: String) async throws -> Response {
        let request = try await makeRequest(url: url, method: method)
        return try await decodeResponse(from: request)
    }

    private func request<Response: Decodable, Body: Encodable>(url: URL, method: String, body: Body) async throws -> Response {
        let request = try await makeRequest(url: url, method: method, body: body)
        return try await decodeResponse(from: request)
    }

    private func decodeResponse<Response: Decodable>(from request: URLRequest) async throws -> Response {
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw AgentAPIError.invalidResponse }
        guard (200 ... 299).contains(http.statusCode) else { throw AgentAPIError.httpStatus(http.statusCode) }
        let envelope = try JSONDecoder().decode(AgentEnvelope<Response>.self, from: data)
        guard envelope.success, let result = envelope.result else {
            throw AgentAPIError.server(envelope.error ?? "服务暂时不可用。")
        }
        return result
    }

    private func makeRequest<Body: Encodable>(path: String, method: String, body: Body) async throws -> URLRequest {
        try await makeRequest(url: baseURL.appending(path: path), method: method, body: body)
    }

    private func makeRequest(url: URL, method: String) async throws -> URLRequest {
        var request = URLRequest(url: url)
        request.httpMethod = method
        let token = try await AuthSession.shared.accessToken()
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(UUID().uuidString, forHTTPHeaderField: "X-Trace-Id")
        return request
    }

    private func makeRequest<Body: Encodable>(url: URL, method: String, body: Body) async throws -> URLRequest {
        var request = try await makeRequest(url: url, method: method)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
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
    let messages: [HistoryMessage]
    let hasMore: Bool
    let nextCursor: Int?
}

private struct HistoryMessage: Decodable {
    let id: String
    let role: String
    let blocks: [HistoryBlock]
}

private struct HistoryBlock: Decodable {
    let type: String
    let content: String?
    let status: String?
    let presentation: ToolPresentationPayload?
    let items: [PresentedMedia]?
    let task: FantoTaskSummary?
    let request: HistoryUserInputRequest?
    let interactionID: String?

    enum CodingKeys: String, CodingKey {
        case type, content, status, presentation, items, task, request
        case interactionID = "interactionId"
    }
}

private struct HistoryUserInputRequest: Decodable {
    let interactionID: String
    let title: String
    let description: String?
    let questions: [FantoUserInputQuestion]
    let resolved: Bool

    enum CodingKeys: String, CodingKey {
        case interactionID = "interactionId"
        case title, description, questions, resolved
    }

    var value: FantoUserInputRequest {
        .init(interactionID: interactionID, title: title, description: description, questions: questions, isResolved: resolved)
    }
}

private struct ToolPresentationPayload: Decodable {
    let visible: Bool
    let displayContent: String
    let animation: String?
}

private struct StreamDelta: Decodable { let text: String }
private struct StreamToolEvent: Decodable {
    let toolCallID: String
    let toolName: String
    let status: String?
    let presentation: ToolPresentationPayload
    let result: StreamToolResult?

    enum CodingKeys: String, CodingKey {
        case toolCallID = "toolCallId"
        case toolName, status, presentation, result
    }
}

private struct StreamToolResult: Decodable {
    let items: [PresentedMedia]?
    let task: FantoTaskSummary?
    let interactionID: String?
    let title: String?
    let description: String?
    let questions: [FantoUserInputQuestion]?

    enum CodingKeys: String, CodingKey {
        case items, task
        case interactionID = "interactionId"
        case title, description, questions
    }

    var userInputRequest: FantoUserInputRequest? {
        guard let interactionID, let title, let questions else { return nil }
        return .init(interactionID: interactionID, title: title, description: description, questions: questions)
    }
}
private struct StreamFailure: Decodable { let error: String }
private nonisolated struct TaskDetailResponse: Decodable {
    let task: FantoTaskDetail

    private enum CodingKeys: String, CodingKey { case task, data }

    init(from decoder: Decoder) throws {
        if let direct = try? FantoTaskDetail(from: decoder) {
            task = direct
            return
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if let value = try? container.decode(FantoTaskDetail.self, forKey: .task) {
            task = value
            return
        }
        task = try container.decode(FantoTaskDetail.self, forKey: .data)
    }
}
private nonisolated struct TaskRunsResponse: Decodable { let data: [FantoTaskRun] }

private func projectHistory(_ entries: [HistoryMessage]) -> [AgentHistoryMessage] {
    entries.compactMap { entry in
        guard let role = ConversationRole(rawValue: entry.role) else { return nil }
        let text = entry.blocks.compactMap { $0.type == "text" ? $0.content : nil }.joined(separator: "\n")
        let media = entry.blocks.flatMap { $0.type == "media" ? ($0.items ?? []) : [] }
        let activities = entry.blocks.enumerated().compactMap { index, block -> ConversationToolActivity? in
            guard block.type == "activity", let presentation = block.presentation else { return nil }
            return .init(
                id: "history-\(entry.id)-\(index)",
                text: presentation.displayContent,
                animation: presentation.animation,
                state: block.status == "failed" ? .failed : .succeeded
            )
        }
        let tasks = entry.blocks.compactMap { $0.type == "task" ? $0.task : nil }
        let request = entry.blocks.compactMap { $0.type == "user_input" ? $0.request?.value : nil }.first
        let responseBlock = entry.blocks.first { $0.type == "user_input_response" }
        let response = responseBlock.flatMap { block -> FantoUserInputResponse? in
            guard let interactionID = block.interactionID, let content = block.content else { return nil }
            return .init(interactionID: interactionID, content: content)
        }
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !media.isEmpty || !activities.isEmpty || !tasks.isEmpty || request != nil || response != nil else { return nil }
        return .init(id: entry.id, role: role, text: text, media: media, activities: activities, tasks: tasks, userInputRequest: request, userInputResponse: response)
    }
}

func mergePresentedMedia(_ current: [PresentedMedia], _ incoming: [PresentedMedia]) -> [PresentedMedia] {
    guard !incoming.isEmpty else { return current }
    var seen = Set(current.map(\.mediaID))
    var merged = current
    for item in incoming where seen.insert(item.mediaID).inserted {
        merged.append(item)
    }
    return merged
}
