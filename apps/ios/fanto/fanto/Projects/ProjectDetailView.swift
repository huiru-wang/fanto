import SwiftUI

struct ProjectDetailView: View {
    let project: Project
    @Environment(FantoStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @State private var detail: ProjectDetail?
    @State private var errorMessage: String?
    @State private var showsArchiveConfirmation = false
    @State private var isArchiving = false
    @State private var showsConversation = false

    private var displayedProject: Project { detail?.project ?? project }
    private var hasSession: Bool { displayedProject.sessionID != nil }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                VStack(alignment: .leading, spacing: 9) {
                    Text(displayedProject.title).font(.title).bold()
                    HStack(spacing: 7) {
                        Image(systemName: displayedProject.status.symbol)
                            .symbolEffect(.pulse, options: .repeating, isActive: displayedProject.status == .running)
                        Text(displayedProject.status.title)
                        Text("·")
                        Text(FantoDateText.timestamp(displayedProject.updatedAt))
                    }
                    .font(.caption)
                    .foregroundStyle(displayedProject.status == .failed ? .orange : .secondary)
                    .accessibilityElement(children: .combine)
                }

                if !displayedProject.content.isEmpty {
                    MarkdownContentView(
                        markdown: displayedProject.content,
                        leadingTitleToOmit: displayedProject.title,
                        allowsHTMLPreview: true
                    )
                } else {
                    VStack(alignment: .leading, spacing: 12) {
                        Text(displayedProject.summary).foregroundStyle(.secondary)
                        if displayedProject.status == .queued {
                            Label("创作已加入等待队列", systemImage: "clock")
                        } else if displayedProject.status == .running {
                            Label("Fanto 正在为你创作", systemImage: "sparkles")
                        } else if displayedProject.status == .failed {
                            Label("本次创作尚未完成", systemImage: "exclamationmark.circle")
                        }
                    }
                    .font(.subheadline)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(18)
                    .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 16))
                }

                if hasSession && (!displayedProject.status.canContinue || displayedProject.content.isEmpty) {
                    Button {
                        showsConversation = true
                    } label: {
                        Label("查看创作过程", systemImage: "bubble.left.and.bubble.right")
                            .font(.subheadline)
                    }
                    .buttonStyle(.bordered)
                }

                if let detail, !detail.referenceRecords.isEmpty {
                    Divider()
                    Text("参考记录 · \(detail.recordCount)").font(.headline)
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(detail.referenceRecords) { record in
                            ProjectRecordTimelineRow(
                                record: record,
                                showsLineAfter: record.id != detail.referenceRecords.last?.id
                            )
                        }
                    }
                }
                if let errorMessage {
                    ContentUnavailableView("部分内容未能加载", systemImage: "exclamationmark.triangle", description: Text(errorMessage))
                    Button("重新加载") { Task { await load() } }
                }
            }
            .padding()
        }
        .navigationTitle("作品")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if displayedProject.status.canArchive {
                Button("归档", systemImage: "archivebox") { showsArchiveConfirmation = true }
                    .disabled(isArchiving)
            }
        }
        .safeAreaInset(edge: .bottom) {
            if displayedProject.status.canContinue, hasSession {
                HStack {
                    Spacer()
                    Button {
                        showsConversation = true
                    } label: {
                        Label(displayedProject.status == .failed ? "继续聊聊" : "继续创作",
                              systemImage: "bubble.left.and.bubble.right")
                            .font(.headline).padding(.horizontal, 18).padding(.vertical, 12)
                    }
                    .buttonStyle(.borderedProminent)
                    .clipShape(Capsule())
                    .padding(.trailing).padding(.bottom, 8)
                }
            }
        }
        .sheet(isPresented: $showsConversation) {
            if let sessionID = displayedProject.sessionID {
                NavigationStack {
                    ProjectSessionConversation(
                        projectID: displayedProject.id,
                        sessionID: sessionID,
                        status: displayedProject.status,
                        onUpdated: { Task { await load() } }
                    )
                    .navigationTitle("创作对话")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .topBarTrailing) {
                            Button("完成") { showsConversation = false }
                        }
                    }
                }
                .presentationDetents([.medium, .large])
            }
        }
        .confirmationDialog(
            "归档后仍可保留成果，但不能继续修改或扩展。",
            isPresented: $showsArchiveConfirmation,
            titleVisibility: .visible
        ) {
            Button("归档项目") { Task { await archive() } }
            Button("取消", role: .cancel) {}
        }
        .refreshable { await load() }
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            await load()
        }
        .task(id: "\(scenePhase)-\(displayedProject.status.rawValue)") {
            guard scenePhase == .active else { return }
            while !Task.isCancelled &&
                    (displayedProject.status == .queued || displayedProject.status == .running) {
                do { try await Task.sleep(for: .seconds(5)) } catch { return }
                if Task.isCancelled { return }
                await load()
            }
        }
    }

    private func load() async {
        do {
            detail = try await FantoAPIClient.shared.fetchProject(id: project.id)
            errorMessage = nil
        } catch {
            if !Task.isCancelled { errorMessage = error.localizedDescription }
        }
    }

    private func archive() async {
        guard !isArchiving, displayedProject.status.canArchive else { return }
        isArchiving = true
        defer { isArchiving = false }
        do {
            try await FantoAPIClient.shared.archiveProject(id: project.id, expectedVersion: displayedProject.version)
            await store.loadProjects()
            dismiss()
        } catch {
            let message = error.localizedDescription
            await load()
            errorMessage = message
        }
    }
}

private struct ProjectSessionConversation: View {
    let projectID: String
    let sessionID: String
    let status: ProjectStatus
    let onUpdated: () -> Void
    @State private var messages: [AgentHistoryMessage] = []
    @State private var taskDetailCache = TaskDetailCache()
    @State private var draft = ""
    @State private var liveText = ""
    @State private var activity = ""
    @State private var liveActivities: [ConversationToolActivity] = []
    @State private var sending = false
    @State private var connected = false
    @State private var errorText: String?

    private var canSend: Bool { status.canContinue && !sending }

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 14) {
                    if messages.isEmpty {
                        Text("创作过程将在这里呈现").foregroundStyle(.secondary)
                    }
                    ForEach(messages) { message in
                        ConversationMessageBubble(message: conversationMessage(message), retry: {}, taskDetailCache: taskDetailCache)
                    }
                    if !liveText.isEmpty || !liveActivities.isEmpty || !activity.isEmpty {
                        ConversationMessageBubble(message: liveMessage, retry: {}, taskDetailCache: taskDetailCache)
                    }
                    if let errorText { Text(errorText).font(.caption).foregroundStyle(.red) }
                }
                .padding()
            }
            if status != .archived {
                HStack(alignment: .bottom, spacing: 8) {
                    TextField(
                        status == .queued ? "等待创作开始…" :
                        status == .running ? "Fanto 正在创作…" : "继续创作或提出修改想法",
                        text: $draft, axis: .vertical
                    )
                    .lineLimit(1...4)
                    .textFieldStyle(.roundedBorder)
                    .disabled(!status.canContinue || sending)
                    Button {
                        Task { await send() }
                    } label: {
                        Image(systemName: "arrow.up.circle.fill").font(.title2)
                    }
                    .disabled(!canSend || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .accessibilityLabel("发送消息")
                }
                .padding()
            }
        }
        .task(id: sessionID) {
            await refresh()
            await observe()
        }
        .onChange(of: status) { _, newValue in
            if newValue != .running && sending {
                sending = false
                liveText = ""
                activity = ""
                Task { await refresh() }
            }
        }
    }

    private func observe() async {
        while !Task.isCancelled {
            do {
                try await AgentAPIClient.shared.observeSession(
                    sessionID: sessionID,
                    onConnected: {
                        Task { @MainActor in connected = true }
                    },
                    onEvent: { event in
                        Task { @MainActor in
                            guard !sending else { return }
                            switch event {
                            case let .delta(text): liveText += text
                            case let .processing(text): activity = text
                            case let .toolActivity(item): upsertActivity(item)
                            case let .failure(reason):
                                errorText = reason
                                awaitFinish()
                            case .done: awaitFinish()
                            default: break
                            }
                        }
                    }
                )
            } catch {
                if Task.isCancelled { return }
                if status == .running { errorText = "实时连接暂时不可用，历史记录仍可查看。" }
            }
            connected = false
            do { try await Task.sleep(for: .seconds(2)) } catch { return }
            await refresh()
        }
    }

    private func hideInternalIds(_ text: String) -> String {
        text.replacingOccurrences(
            of: "(?i)(mediaId|projectId|sessionId)\\s*(是|为|[:=])\\s*`?[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}`?",
            with: "素材已确认", options: .regularExpression
        )
    }

    private func conversationMessage(_ item: AgentHistoryMessage) -> ConversationMessage {
        .init(id: item.id, role: item.role, text: item.role == .assistant ? hideInternalIds(item.text) : item.text, media: item.media, activities: item.activities,
              tasks: item.tasks, userInputRequest: item.userInputRequest, userInputResponse: item.userInputResponse, state: .complete)
    }

    private var liveMessage: ConversationMessage {
        .init(id: "creator-live", role: .assistant, text: hideInternalIds(liveText), activities: liveActivities,
              state: .streaming)
    }

    private func upsertActivity(_ item: ConversationToolActivity) {
        if let index = liveActivities.firstIndex(where: { $0.id == item.id }) {
            liveActivities[index] = item
        } else {
            liveActivities.append(item)
        }
    }

    private func awaitFinish() {
        sending = false
        liveActivities = []
        liveText = ""
        activity = ""
        Task {
            await refresh()
            onUpdated()
        }
    }

    private func refresh() async {
        do {
            let page = try await AgentAPIClient.shared.fetchHistory(sessionID: sessionID)
            messages = page.messages
        } catch {
            if !Task.isCancelled { errorText = error.localizedDescription }
        }
    }

    private func send() async {
        let message = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !message.isEmpty, canSend else { return }
        sending = true
        liveActivities = []
        liveText = ""
        activity = "正在回应…"
        errorText = nil
        do {
            draft = ""
            try await AgentAPIClient.shared.stream(sessionID: sessionID, message: message, metadata: StreamMetadata(projectID: projectID)) { event in
                Task { @MainActor in
                    switch event {
                    case let .delta(text): liveText += text
                    case let .processing(text): activity = text
                    case let .toolActivity(item): upsertActivity(item)
                    case let .failure(reason): errorText = reason
                    default: break
                    }
                }
            }
            awaitFinish()
        } catch {
            errorText = error.localizedDescription
            sending = false
            activity = ""
            liveText = ""
            await refresh()
            onUpdated()
        }
    }
}
