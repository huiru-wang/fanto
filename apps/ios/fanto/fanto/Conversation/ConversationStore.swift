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
    private(set) var hasMoreHistory = false
    private(set) var isLoadingEarlierHistory = false
    private(set) var historyLoadEarlierError: String?
    private(set) var historyRestoreAnchorID: String?

    private let client: AgentAPIClient
    private let persistence: AgentSessionPersistence
    private var sessionID: String?
    private var historyNextCursor: Int?
    private var activeAssistantMessageID: String?
    private var activePrompt: String?
    private var textBlockOpen = false
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
                    let page = try await client.fetchHistory(sessionID: storedID)
                    messages = project(page.messages)
                    hasMoreHistory = page.hasMore
                    historyNextCursor = page.nextCursor
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

    func reset() {
        runTask?.cancel()
        runTask = nil
        sessionID = nil
        activeAssistantMessageID = nil
        activePrompt = nil
        pendingPresentedMedia = []
        messages = []
        draft = ""
        loadState = .idle
        scrollAnchorID = nil
        hasMoreHistory = false
        isLoadingEarlierHistory = false
        historyLoadEarlierError = nil
        historyRestoreAnchorID = nil
        historyNextCursor = nil
        localMessageSequence = 0
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
        textBlockOpen = false
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
                // Only the SSE done event completes the reply; EOF alone is incomplete.
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
        hasMoreHistory = false
        historyNextCursor = nil
    }

    func loadEarlierHistory() async {
        guard let sessionID,
              hasMoreHistory,
              let historyNextCursor,
              !isLoadingEarlierHistory
        else { return }

        let visibleTopMessageID = messages.first?.id
        isLoadingEarlierHistory = true
        historyLoadEarlierError = nil
        defer { isLoadingEarlierHistory = false }

        do {
            let page = try await client.fetchHistory(sessionID: sessionID, cursor: historyNextCursor)
            let knownIDs = Set(messages.map(\.id))
            let olderMessages = project(page.messages).filter { !knownIDs.contains($0.id) }
            messages = olderMessages + messages
            hasMoreHistory = page.hasMore
            self.historyNextCursor = page.nextCursor
            historyRestoreAnchorID = visibleTopMessageID
        } catch {
            historyLoadEarlierError = userVisibleError(for: error)
        }
    }

    func consumeHistoryRestoreAnchor(_ id: String) {
        guard historyRestoreAnchorID == id else { return }
        historyRestoreAnchorID = nil
    }

    private func receive(_ event: AgentStreamEvent) {
        guard let id = activeAssistantMessageID else { return }
        switch event {
        case .processing:
            updateMessage(id: id) { $0.state = .processing }
        case .messageStart, .messageEnd:
            textBlockOpen = false
        case let .delta(text):
            let startsNewBlock = !textBlockOpen
            textBlockOpen = true
            updateMessage(id: id) { message in
                if startsNewBlock {
                    if !message.text.isEmpty { message.text.append("\n\n") }
                    message.streamBlocks.append(.text(text))
                } else if let index = message.streamBlocks.lastIndex(where: { if case .text = $0 { return true }; return false }),
                          case let .text(current) = message.streamBlocks[index] {
                    message.streamBlocks[index] = .text(current + text)
                }
                message.text.append(text)
                message.state = .streaming
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
                    message.streamBlocks.append(.activity(activity.id))
                }
                message.state = .processing
            }
            scrollAnchorID = id
        case let .taskCreated(task):
            updateMessage(id: id) { message in
                if !message.tasks.contains(where: { $0.taskID == task.taskID }) {
                    message.tasks.append(task)
                    message.streamBlocks.append(.task(task.taskID))
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

    private func project(_ messages: [AgentHistoryMessage]) -> [ConversationMessage] {
        messages.map {
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
    }

    private func userVisibleError(for error: Error) -> String {
        if let error = error as? AgentAPIError {
            return error.errorDescription ?? "暂时无法连接 Fanto，请稍后重试。"
        }
        return "暂时无法连接 Fanto，请检查网络或服务证书后重试。"
    }
}
