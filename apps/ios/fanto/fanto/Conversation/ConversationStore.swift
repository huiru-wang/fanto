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
    private var sessionID: String?
    private weak var settingsStore: FantoSettingsStore?
    private(set) var isClearingHistory = false
    private var pendingClearSessionID: String?
    private var historyNextCursor: Int?
    private var activeAssistantMessageID: String?
    private var activePrompt: String?
    private var textBlockOpen = false
    private var pendingPresentedMedia: [PresentedMedia] = []
    private(set) var isEndingOperation = false
    private(set) var isRecovering = false
    private var recoveryTask: Task<Void, Never>?
    private var runTask: Task<Void, Never>?
    private var stopTask: Task<Void, Never>?
    private var stopRequestID: UUID?
    private var isStopping = false
    private var localMessageSequence = 0

    init(client: AgentAPIClient = .shared) {
        self.client = client
    }

    var isReady: Bool {
        if case .ready = loadState { return true }
        return false
    }

    var isResponding: Bool { runTask != nil || isStopping || isRecovering || isClearingHistory }

    func load(profile: FantoSettingsStore? = nil) async {
        if let profile { settingsStore = profile }
        guard !isReady, loadState != .loading else { return }
        loadState = .loading

        do {
            let settings = try await FantoAPIClient.shared.fetchFantoSettings()
            settingsStore?.accept(settings)
            if let storedID = settings.sessionId {
                do {
                    let page = try await client.fetchHistory(sessionID: storedID)
                    messages = project(page.messages)
                    hasMoreHistory = page.hasMore
                    historyNextCursor = page.nextCursor
                    sessionID = storedID
                    if page.running { recoverConversation() }
                } catch let error as AgentAPIError where error.invalidatesSession {
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
        recoveryTask?.cancel()
        recoveryTask = nil
        isRecovering = false
        isEndingOperation = false
        stopTask?.cancel()
        stopTask = nil
        isStopping = false
        runTask?.cancel()
        runTask = nil
        sessionID = nil
        pendingClearSessionID = nil
        isClearingHistory = false
        activeAssistantMessageID = nil
        activePrompt = nil
        textBlockOpen = false
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
        guard isReady, !isClearingHistory, runTask == nil, !isStopping, !isRecovering, sessionID != nil, !prompt.isEmpty else { return }

        draft = ""
        messages.append(.user(id: nextLocalMessageID(), text: prompt))
        beginRun(message: prompt)
    }

    func submitUserInput(request: FantoUserInputRequest, answers: [String]) {
        guard isReady, !isClearingHistory, runTask == nil, !isStopping, !isRecovering, sessionID != nil, answers.count == request.questions.count else { return }
        let visibleText = zip(request.questions, answers)
            .map { "\($0.label)：\($1)" }
            .joined(separator: "\n")
        guard !visibleText.isEmpty else { return }

        updateUserInputRequest(interactionID: request.interactionID) { $0.isResolved = true }
        messages.append(.userInputResponse(id: nextLocalMessageID(), interactionID: request.interactionID, content: visibleText))
        beginRun(message: "[[fanto-user-input:\(request.interactionID)]]\n\(visibleText)")
    }

    private func beginRun(message: String) {
        guard isReady, !isClearingHistory, runTask == nil, !isStopping, !isRecovering, let sessionID else { return }
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
                    self.failActiveMessage("连接已中断，正在恢复对话。")
                    self.recoverConversation()
                }
            }

            do {
                try await client.stream(sessionID: sessionID, message: message) { [weak self] event in
                    guard self?.activeAssistantMessageID == assistant.id else { return }
                    self?.receive(event)
                }
                // Only the SSE done event completes the reply; EOF alone is incomplete.
            } catch is CancellationError {
                // stop() already sets the visible terminal state. Other cancellation paths
                // are converted to a retryable failure by the deferred terminal-state guard.
            } catch {
                if self.activeAssistantMessageID == assistant.id {
                    self.failActiveMessage(self.userVisibleError(for: error))
                    self.recoverConversation()
                }
            }
        }
    }

    // Reconcile durable history after a lost connection; never replay the POST.
    func recoverConversation() {
        guard !isClearingHistory, runTask == nil, !isStopping, recoveryTask == nil, let sessionID else { return }
        isRecovering = true
        recoveryTask = Task { [weak self, client] in
            while !Task.isCancelled {
                do {
                    let page = try await client.fetchHistory(sessionID: sessionID)
                    try Task.checkCancellation()
                    guard let self, self.sessionID == sessionID else { return }
                    self.isEndingOperation = page.stopping
                    if page.running { self.messages = self.project(page.messages) }
                    if !page.running {
                        self.messages = self.project(page.messages)
                        self.hasMoreHistory = page.hasMore
                        self.historyNextCursor = page.nextCursor
                        self.isRecovering = false
                        self.recoveryTask = nil
                        self.scrollAnchorID = self.messages.last?.id
                        return
                    }
                } catch is CancellationError { return }
                catch { /* Preserve visible content and keep sending locked until reconciled. */ }
                do { try await Task.sleep(for: .milliseconds(1500)) }
                catch { return }
            }
        }
    }

    func stop() {
        guard !isRecovering, !isStopping, let id = activeAssistantMessageID, let sessionID else { return }
        isStopping = true
        let requestID = UUID()
        stopRequestID = requestID
        let runningTask = runTask
        stopTask = Task { [weak self, client] in
            guard let self else { return }
            var waitingForTool = false
            defer {
                if !waitingForTool, self.stopRequestID == requestID { self.isStopping = false; self.stopTask = nil; self.stopRequestID = nil }
            }
            do {
                let stillStopping = try await client.stopSession(sessionID: sessionID)
                guard self.sessionID == sessionID, self.activeAssistantMessageID == id else { return }
                if stillStopping {
                    waitingForTool = true
                    self.isEndingOperation = true
                    return
                }
                runningTask?.cancel()
                if self.activeAssistantMessageID == id { self.stopActiveMessage() }
                self.isStopping = false
                self.stopTask = nil
                let messageIDs = self.messages.map(\.id)
                guard let page = try? await client.fetchHistory(sessionID: sessionID) else { return }
                guard self.sessionID == sessionID, self.activeAssistantMessageID == nil, self.messages.map(\.id) == messageIDs else { return }
                self.messages = self.project(page.messages)
                self.hasMoreHistory = page.hasMore
                self.historyNextCursor = page.nextCursor
            } catch {
                self.updateMessage(id: id) { $0.state = .failed("停止未确认，请重试。") }
            }
        }
    }

    private func stopActiveMessage() {
        isStopping = false
        stopRequestID = nil
        stopTask = nil
        isEndingOperation = false
        guard let id = activeAssistantMessageID else { return }
        updateMessage(id: id) {
            $0.media = pendingPresentedMedia
            $0.state = .stopped
        }
        activeAssistantMessageID = nil
        activePrompt = nil
        pendingPresentedMedia = []
        runTask = nil
    }

    func retryLastMessage() {
        guard !isResponding else { return }
        guard let prompt = activePrompt else { return }
        activePrompt = nil
        draft = prompt
        send()
    }

    func clearHistory(profile: FantoSettingsStore) async throws {
        guard isReady, !isResponding, let originalID = sessionID,
              let scope = AccountCache.shared.scope else {
            throw NSError(domain: "FantoConversation", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "请等待当前对话操作完成后再清除。"])
        }
        guard profile.settings?.sessionId == originalID else {
            throw SettingFieldConflict(remoteValue: profile.settings?.sessionId)
        }
        isClearingHistory = true
        defer { isClearingHistory = false }
        // Keep an unconfirmed new ID for an explicit retry, never automatically create another session.
        let createdID: String
        if let pendingClearSessionID { createdID = pendingClearSessionID }
        else {
            createdID = try await client.createSession()
            guard AccountCache.shared.scope == scope, sessionID == originalID else { throw CancellationError() }
            pendingClearSessionID = createdID
        }
        guard AccountCache.shared.scope == scope, sessionID == originalID else { throw CancellationError() }
        try await profile.selectSession(createdID, original: originalID)
        guard AccountCache.shared.scope == scope, sessionID == originalID else { throw CancellationError() }
        reset()
        sessionID = createdID
        loadState = .ready
    }

    private func selectMainSession(_ id: String) async throws {
        for attempt in 0..<2 {
            let settings = try await FantoAPIClient.shared.fetchFantoSettings()
            var changes = FantoSettingsChanges()
            changes.sessionId = id
            do {
                let updated = try await FantoAPIClient.shared.updateFantoSettings(version: settings.version, changes: changes)
                settingsStore?.accept(updated)
                return
            } catch let error as FantoAPIError where error.code == "VERSION_CONFLICT" && attempt == 0 {
                continue
            }
        }
    }

    private func createSession() async throws {
        let createdID = try await client.createSession()
        try await selectMainSession(createdID)
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
            guard self.sessionID == sessionID else { return }
            let knownIDs = Set(messages.map(\.id))
            let olderMessages = project(page.messages).filter { !knownIDs.contains($0.id) }
            messages = olderMessages + messages
            hasMoreHistory = page.hasMore
            self.historyNextCursor = page.nextCursor
            historyRestoreAnchorID = visibleTopMessageID
        } catch {
            guard self.sessionID == sessionID else { return }
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
        case .finalizing:
            break
        case .processing:
            isEndingOperation = false
            updateMessage(id: id) { $0.state = .processing }
        case .messageStart, .messageEnd:
            textBlockOpen = false
        case let .delta(text):
            guard !isStopping else { return }
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
        case let .userInputRequested(request):
            updateMessage(id: id) { $0.userInputRequest = request }
            scrollAnchorID = id
        case .stopped:
            stopActiveMessage()
        case .done:
            isEndingOperation = false
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
        isStopping = false
        isEndingOperation = false
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
                userInputRequest: $0.userInputRequest,
                userInputResponse: $0.userInputResponse,
                state: $0.stopped ? .stopped : .complete
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
