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
    private var pendingPresentedMedia: [PresentedMedia] = []
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
                        ConversationMessage(
                            id: $0.id,
                            role: $0.role,
                            text: $0.text,
                            media: $0.media,
                            activities: $0.activities,
                            tasks: $0.tasks,
                            userInputRequest: $0.userInputRequest,
                            userInputResponse: $0.userInputResponse,
                            state: .complete
                        )
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
        guard !prompt.isEmpty else { return }

        draft = ""
        messages.append(.user(id: nextLocalMessageID(), text: prompt))
        beginRun(message: prompt)
    }

    func submitUserInput(request: FantoUserInputRequest, answers: [String]) {
        guard isReady, runTask == nil, sessionID != nil, answers.count == request.questions.count else { return }
        let visibleText = zip(request.questions, answers)
            .map { "\($0.label)：\($1)" }
            .joined(separator: "\n")
        guard !visibleText.isEmpty else { return }

        updateUserInputRequest(interactionID: request.interactionID) { $0.isResolved = true }
        messages.append(.userInputResponse(id: nextLocalMessageID(), interactionID: request.interactionID, content: visibleText))
        beginRun(message: "[[fanto-user-input:\(request.interactionID)]]\n\(visibleText)")
    }

    private func beginRun(message: String) {
        guard isReady, runTask == nil, let sessionID else { return }
        let assistant = ConversationMessage.assistantPlaceholder(id: nextLocalMessageID())
        messages.append(assistant)
        activeAssistantMessageID = assistant.id
        activePrompt = message
        pendingPresentedMedia = []
        scrollAnchorID = assistant.id

        runTask = Task { [weak self, client] in
            guard let self else { return }
            defer {
                if self.activeAssistantMessageID == assistant.id {
                    self.failActiveMessage("回复意外中断，请重新发送。")
                }
            }

            do {
                try await client.stream(sessionID: sessionID, message: message) { [weak self] event in
                    self?.receive(event)
                }
                if !Task.isCancelled { self.completeActiveMessage() }
            } catch is CancellationError {
                // stop() already sets the visible terminal state. Other cancellation paths
                // are converted to a retryable failure by the deferred terminal-state guard.
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
        pendingPresentedMedia = []
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
        case let .presentation(items):
            pendingPresentedMedia = mergePresentedMedia(pendingPresentedMedia, items)
        case let .toolActivity(activity):
            updateMessage(id: id) { message in
                if let index = message.activities.firstIndex(where: { $0.id == activity.id }) {
                    message.activities[index] = activity
                } else {
                    message.activities.append(activity)
                }
                message.state = .processing
            }
            scrollAnchorID = id
        case let .taskCreated(task):
            updateMessage(id: id) { message in
                if !message.tasks.contains(where: { $0.taskID == task.taskID }) {
                    message.tasks.append(task)
                }
            }
            scrollAnchorID = id
        case let .userInputRequested(request):
            updateMessage(id: id) { $0.userInputRequest = request }
            scrollAnchorID = id
        case .done:
            completeActiveMessage()
        case .failure:
            failActiveMessage("这次回复没有完成，请重新发送。")
        }
    }

    private func completeActiveMessage() {
        guard let id = activeAssistantMessageID else { return }
        guard let message = messages.first(where: { $0.id == id }),
              messageHasRenderableContent(message) || !pendingPresentedMedia.isEmpty
        else {
            failActiveMessage("这次回复没有返回内容，请重新发送。")
            return
        }
        updateMessage(id: id) {
            $0.media = pendingPresentedMedia
            $0.state = .complete
        }
        activeAssistantMessageID = nil
        activePrompt = nil
        pendingPresentedMedia = []
        runTask = nil
        scrollAnchorID = id
    }

    private func failActiveMessage(_ message: String) {
        guard let id = activeAssistantMessageID else { return }
        updateMessage(id: id) { $0.state = .failed(message) }
        activeAssistantMessageID = nil
        pendingPresentedMedia = []
        runTask = nil
    }

    private func updateMessage(id: String, update: (inout ConversationMessage) -> Void) {
        guard let index = messages.firstIndex(where: { $0.id == id }) else { return }
        update(&messages[index])
    }

    private func updateUserInputRequest(interactionID: String, update: (inout FantoUserInputRequest) -> Void) {
        guard let index = messages.indices.reversed().first(where: { messages[$0].userInputRequest?.interactionID == interactionID }),
              var request = messages[index].userInputRequest
        else { return }
        update(&request)
        messages[index].userInputRequest = request
    }

    private func messageHasRenderableContent(_ message: ConversationMessage) -> Bool {
        !message.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || !message.activities.isEmpty
            || !message.tasks.isEmpty
            || message.userInputRequest != nil
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
