import Foundation
import Observation

enum ConversationLoadState: Equatable {
    case idle
    case loading
    case ready
    case failed(String)
}

@Observable
@MainActor
final class ConversationStore {
    var messages: [ConversationMessage] = []
    var draft = ""
    var loadState: ConversationLoadState = .idle
    var scrollAnchorID: String?

    private let client: AgentAPIClient
    private let persistence: AgentSessionPersistence
    private var sessionID: String?
    private var activeAssistantMessageID: String?
    private var activePrompt: String?
    private var runTask: Task<Void, Never>?
    private var localMessageSequence = 0

    init(client: AgentAPIClient = .shared, persistence: AgentSessionPersistence = .init()) {
        self.client = client
        self.persistence = persistence
    }

    var isReady: Bool {
        if case .ready = loadState { return true }
        return false
    }

    var isResponding: Bool { runTask != nil }

    func load() async {
        guard !isReady, loadState != .loading else { return }
        loadState = .loading

        do {
            if let storedID = try persistence.load(userID: client.userID, agentID: client.agentID) {
                do {
                    messages = try await client.fetchHistory(sessionID: storedID).map {
                        ConversationMessage(id: $0.id, role: $0.role, text: $0.text, state: .complete)
                    }
                    sessionID = storedID
                } catch let error as AgentAPIError where error.invalidatesSession {
                    try persistence.clear(userID: client.userID, agentID: client.agentID)
                    try await createSession()
                }
            } else {
                try await createSession()
            }
            loadState = .ready
            scrollAnchorID = messages.last?.id
        } catch {
            loadState = .failed(userVisibleError(for: error))
        }
    }

    func retryLoading() {
        loadState = .idle
        Task { await load() }
    }

    func send() {
        let prompt = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard isReady, !prompt.isEmpty, runTask == nil, let sessionID else { return }

        draft = ""
        messages.append(.user(id: nextLocalMessageID(), text: prompt))
        let assistant = ConversationMessage.assistantPlaceholder(id: nextLocalMessageID())
        messages.append(assistant)
        activeAssistantMessageID = assistant.id
        activePrompt = prompt
        scrollAnchorID = assistant.id

        runTask = Task { [weak self, client] in
            guard let self else { return }
            do {
                try await client.stream(sessionID: sessionID, message: prompt) { [weak self] event in
                    self?.receive(event)
                }
                if !Task.isCancelled { self.completeActiveMessage() }
            } catch is CancellationError {
                // stop() already sets the visible terminal state.
            } catch {
                self.failActiveMessage(self.userVisibleError(for: error))
            }
        }
    }

    func stop() {
        guard let id = activeAssistantMessageID else { return }
        updateMessage(id: id) { $0.state = .stopped }
        activeAssistantMessageID = nil
        activePrompt = nil
        runTask?.cancel()
        runTask = nil
    }

    func retryLastMessage() {
        guard let prompt = activePrompt else { return }
        activePrompt = nil
        draft = prompt
        send()
    }

    private func createSession() async throws {
        let createdID = try await client.createSession()
        try persistence.save(createdID, userID: client.userID, agentID: client.agentID)
        sessionID = createdID
        messages = []
    }

    private func receive(_ event: AgentStreamEvent) {
        guard let id = activeAssistantMessageID else { return }
        switch event {
        case .processing:
            updateMessage(id: id) { $0.state = .processing }
        case let .delta(text):
            updateMessage(id: id) {
                $0.text.append(text)
                $0.state = .streaming
            }
            scrollAnchorID = id
        case .done:
            completeActiveMessage()
        case .failure:
            failActiveMessage("这次回复没有完成，请重新发送。")
        }
    }

    private func completeActiveMessage() {
        guard let id = activeAssistantMessageID else { return }
        updateMessage(id: id) { $0.state = .complete }
        activeAssistantMessageID = nil
        activePrompt = nil
        runTask = nil
    }

    private func failActiveMessage(_ message: String) {
        guard let id = activeAssistantMessageID else { return }
        updateMessage(id: id) { $0.state = .failed(message) }
        activeAssistantMessageID = nil
        runTask = nil
    }

    private func updateMessage(id: String, update: (inout ConversationMessage) -> Void) {
        guard let index = messages.firstIndex(where: { $0.id == id }) else { return }
        update(&messages[index])
    }

    private func nextLocalMessageID() -> String {
        localMessageSequence += 1
        return "local-\(localMessageSequence)"
    }

    private func userVisibleError(for error: Error) -> String {
        if let error = error as? AgentAPIError {
            return error.errorDescription ?? "暂时无法连接 Fanto，请稍后重试。"
        }
        return "暂时无法连接 Fanto，请检查网络或服务证书后重试。"
    }
}
