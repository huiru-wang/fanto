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

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Text(displayedProject.title).font(.title).bold()
                Text("\(displayedProject.status.title) · \(FantoDateText.timestamp(displayedProject.updatedAt))")
                    .font(.caption).foregroundStyle(.secondary)
                if !displayedProject.content.isEmpty {
                    MarkdownContentView(markdown: displayedProject.content, leadingTitleToOmit: displayedProject.title, allowsHTMLPreview: true)
                } else {
                    Text(displayedProject.summary).foregroundStyle(.secondary)
                    if let sessionID = displayedProject.sessionID {
                        ProjectSessionConversation(projectID: displayedProject.id, sessionID: sessionID, onUpdated: { Task { await load() } })
                    } else {
                        Text("正在准备创作会话").font(.caption).foregroundStyle(.secondary)
                    }
                }
                if let detail, !detail.referenceRecords.isEmpty {
                    Divider()
                    Text("参考记录 · \(detail.recordCount)").font(.headline)
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(detail.referenceRecords) { record in
                            ProjectRecordTimelineRow(record: record, showsLineAfter: record.id != detail.referenceRecords.last?.id)
                        }
                    }
                }
                if let errorMessage {
                    ContentUnavailableView("部分内容未能加载", systemImage: "exclamationmark.triangle", description: Text(errorMessage))
                    Button("重新加载") { Task { await load() } }
                }
            }.padding()
        }
        .navigationTitle("创作成果")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if displayedProject.status == .active {
                Button("归档", systemImage: "archivebox") { showsArchiveConfirmation = true }
                    .disabled(isArchiving)
            }
        }
        .safeAreaInset(edge: .bottom) {
            if !displayedProject.content.isEmpty, displayedProject.status == .active, displayedProject.sessionID != nil {
                HStack {
                    Spacer()
                    Button {
                        showsConversation = true
                    } label: {
                        Label("继续创作", systemImage: "bubble.left.and.bubble.right")
                            .font(.headline).padding(.horizontal, 18).padding(.vertical, 12)
                    }
                    .buttonStyle(.borderedProminent).clipShape(Capsule())
                    .padding(.trailing).padding(.bottom, 8)
                }
            }
        }
        .sheet(isPresented: $showsConversation) {
            if let sessionID = displayedProject.sessionID {
                NavigationStack {
                    ProjectSessionConversation(projectID: displayedProject.id, sessionID: sessionID, onUpdated: { Task { await load() } })
                        .navigationTitle("继续创作").navigationBarTitleDisplayMode(.inline)
                        .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("完成") { showsConversation = false } } }
                }.presentationDetents([.medium, .large])
            }
        }
        .confirmationDialog("归档后仍可保留成果，但不能继续修改或扩展。", isPresented: $showsArchiveConfirmation, titleVisibility: .visible) {
            Button("归档项目") { Task { await archive() } }
            Button("取消", role: .cancel) {}
        }
        .refreshable { await load() }
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            await load()
        }
    }
    private func load() async {
        do {
            detail = try await FantoAPIClient.shared.fetchProject(id: project.id)
            errorMessage = nil
        } catch { errorMessage = error.localizedDescription }
    }
    private func archive() async {
        guard !isArchiving else { return }
        isArchiving = true
        defer { isArchiving = false }
        do {
            try await FantoAPIClient.shared.archiveProject(id: project.id, expectedVersion: displayedProject.version)
            await store.loadProjects()
            dismiss()
        } catch { errorMessage = error.localizedDescription }
    }
}

private struct ProjectSessionConversation: View {
    let projectID: String
    let sessionID: String
    let onUpdated: () -> Void
    @State private var messages: [AgentHistoryMessage] = []
    @State private var draft = ""
    @State private var liveText = ""
    @State private var activity = ""
    @State private var sending = false
    @State private var errorText: String?

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 14) {
                    if messages.isEmpty { Text("创作过程将在这里呈现").foregroundStyle(.secondary) }
                    ForEach(messages) { message in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(message.role == .user ? "你" : "Fanto").font(.caption).foregroundStyle(.secondary)
                            if !message.text.isEmpty { Text(message.text).textSelection(.enabled) }
                            ForEach(message.activities) { item in Text(item.text).font(.caption).foregroundStyle(.secondary) }
                        }.frame(maxWidth: .infinity, alignment: .leading)
                    }
                    if !activity.isEmpty { Text(activity).font(.caption).foregroundStyle(.secondary) }
                    if !liveText.isEmpty { Text(liveText) }
                    if let errorText { Text(errorText).font(.caption).foregroundStyle(.red) }
                }.padding()
            }
            HStack(alignment: .bottom, spacing: 8) {
                TextField("继续创作或提出修改想法", text: $draft, axis: .vertical)
                    .lineLimit(1...4).textFieldStyle(.roundedBorder)
                Button {
                    Task { await send() }
                } label: { Image(systemName: "arrow.up.circle.fill").font(.title2) }
                    .disabled(sending || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }.padding()
        }
        .task {
            await refresh()
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(3))
                if Task.isCancelled { break }
                await refresh()
            }
        }
        .task {
            do {
                try await AgentAPIClient.shared.observeProject(projectID: projectID) { event in
                    Task { @MainActor in
                        switch event {
                        case let .delta(text): if !sending { liveText += text }
                        case let .processing(text): if !sending { activity = text }
                        case let .toolActivity(item): if !sending { activity = item.text }
                        case .done:
                            liveText = ""
                            activity = ""
                            Task { await refresh() }
                        default: break
                        }
                    }
                }
            } catch {
                // Polling the stored Session history remains available.
            }
        }
    }
    private func refresh() async {
        do {
            let page = try await AgentAPIClient.shared.fetchHistory(sessionID: sessionID, projectID: projectID)
            messages = page.messages
            errorText = nil
            onUpdated()
        } catch { errorText = error.localizedDescription }
    }
    private func send() async {
        let message = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !message.isEmpty, !sending else { return }
        sending = true
        draft = ""
        liveText = ""
        activity = "正在回应…"
        do {
            try await AgentAPIClient.shared.stream(sessionID: sessionID, message: message, projectID: projectID) { event in
                Task { @MainActor in
                    switch event {
                    case let .delta(text): liveText += text
                    case let .processing(text): activity = text
                    case let .toolActivity(item): activity = item.text
                    case let .failure(reason): errorText = reason
                    default: break
                    }
                }
            }
            await refresh()
        } catch { errorText = error.localizedDescription }
        liveText = ""
        activity = ""
        sending = false
    }
}
