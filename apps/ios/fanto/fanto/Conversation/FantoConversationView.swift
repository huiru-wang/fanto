import SwiftUI

struct FantoConversationView: View {
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.fantoProfile) private var profile
    @State private var fallbackProfile = FantoSettingsStore()
    private var currentProfile: FantoSettingsStore { profile ?? fallbackProfile }
    @Bindable var store: ConversationStore
    @State private var hasLeftHistoryTop = false

    var body: some View {
        NavigationStack {
            Group {
                switch store.loadState {
                case .idle, .loading:
                    ProgressView("正在恢复对话")
                case let .failed(message):
                    VStack(spacing: 16) {
                        ContentUnavailableView("暂时无法连接 Fanto", systemImage: "wifi.exclamationmark", description: Text(message))
                        Button("重新加载") { store.retryLoading() }
                    }
                case .ready:
                    conversation
                }
            }
            .navigationTitle("")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    NavigationLink {
                        FantoSettingsView(profile: currentProfile)
                    } label: {
                        HStack(spacing: 8) {
                            ConversationAvatar(isFanto: true, size: 32, personalized: true)
                            Text(currentProfile.settings?.nickname ?? "Fanto").font(.headline).lineLimit(1)
                        }
                    }
                    .accessibilityLabel("Fanto，查看角色设定")
                }

            }
            .environment(\.fantoProfile, currentProfile)
            .task { await currentProfile.load() }
            .task { await store.load() }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { store.recoverConversation() }
            }
        }
    }

    private var conversation: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 24) {
                    historyPaginationHeader
                    if store.messages.isEmpty {
                        welcome
                    } else {
                        ForEach(store.messages) { message in
                            ConversationMessageBubble(
                                message: message,
                                personalized: true,
                                retry: store.retryLastMessage
                            )
                            .id(message.id)
                        }
                    }
                }
                .padding(.horizontal)
                .padding(.vertical, 18)
            }
            .scrollDismissesKeyboard(.interactively)
            .onScrollGeometryChange(for: Bool.self, of: { geometry in
                geometry.contentOffset.y <= geometry.contentInsets.top + 4
            }) { wasAtTop, isAtTop in
                if !isAtTop {
                    hasLeftHistoryTop = true
                } else if hasLeftHistoryTop, !wasAtTop {
                    Task { await store.loadEarlierHistory() }
                }
            }
            .safeAreaInset(edge: .top, spacing: 8) {
                if let request = pendingUserInputRequest {
                    UserInputPrompt(request: request) { request, answers in
                        store.submitUserInput(request: request, answers: answers)
                    }
                    .padding(.horizontal)
                    .id(request.interactionID)
                    .transition(.move(edge: .top).combined(with: .opacity))
                }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                VStack(spacing: 0) {
                    if store.isRecovering || store.isEndingOperation {
                        Text(store.isEndingOperation ? "正在结束当前操作，你可以先输入下一条消息。" : "正在恢复对话…")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    composer
                }
            }
            .onChange(of: store.scrollAnchorID) { _, anchor in
                guard let anchor else { return }
                scrollToBottom(anchor, with: proxy, animated: true)
            }
            .onChange(of: store.historyRestoreAnchorID) { _, anchor in
                guard let anchor else { return }
                var transaction = Transaction()
                transaction.disablesAnimations = true
                withTransaction(transaction) {
                    proxy.scrollTo(anchor, anchor: .top)
                }
                store.consumeHistoryRestoreAnchor(anchor)
            }
            .task(id: store.scrollAnchorID) {
                guard let anchor = store.scrollAnchorID else { return }
                await Task.yield()
                scrollToBottom(anchor, with: proxy, animated: false)
            }
        }
    }

    @ViewBuilder
    private var historyPaginationHeader: some View {
        if store.isLoadingEarlierHistory {
            ProgressView("正在加载更早对话")
                .frame(maxWidth: .infinity)
                .padding(.bottom, 4)
        } else if let message = store.historyLoadEarlierError {
            Button {
                Task { await store.loadEarlierHistory() }
            } label: {
                Label("加载更早对话失败，点按重试", systemImage: "arrow.clockwise")
                    .font(.subheadline.weight(.medium))
            }
            .buttonStyle(.bordered)
            .frame(maxWidth: .infinity)
            .padding(.bottom, 4)
            .accessibilityHint(message)
        }
    }

    private func scrollToBottom(_ anchor: String, with proxy: ScrollViewProxy, animated: Bool) {
        if animated && !reduceMotion {
            withAnimation(.easeOut(duration: 0.18)) {
                proxy.scrollTo(anchor, anchor: .bottom)
            }
        } else {
            var transaction = Transaction()
            transaction.disablesAnimations = true
            withTransaction(transaction) {
                proxy.scrollTo(anchor, anchor: .bottom)
            }
        }
    }

    private var pendingUserInputRequest: FantoUserInputRequest? {
        store.messages.reversed().compactMap { message -> FantoUserInputRequest? in
            guard let request = message.userInputRequest, !request.isResolved else { return nil }
            return request
        }.first
    }

    private var welcome: some View {
        ContentUnavailableView {
            Label("和 Fanto 聊聊", systemImage: "message")
        } description: {
            Text("这里会延续这段对话。你可以从现在想说的事情开始。")
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 80)
    }

    private var composer: some View {
        HStack(alignment: .bottom, spacing: 10) {
            TextField(text: $store.draft, axis: .vertical) {
                Text("和 Fanto 聊聊").foregroundStyle(.secondary)
            }
                .lineLimit(1 ... 5)
                .padding(.leading, 18)
                .padding(.vertical, 12)
                .disabled(pendingUserInputRequest != nil)
                .accessibilityLabel("输入消息")

            Button {
                if store.isResponding {
                    store.stop()
                } else {
                    store.send()
                }
            } label: {
                Image(systemName: store.isRecovering ? "arrow.trianglehead.2.clockwise.rotate.90" : store.isResponding ? "stop.fill" : "arrow.up")
                    .font(.headline)
                    .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
                    .frame(width: 44, height: 44)
                    .foregroundStyle(.white)
                    .background(store.isResponding || !store.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? FantoTheme.accent : Color.secondary, in: Circle())
            }
            .disabled(store.isEndingOperation || store.isRecovering || (!store.isResponding && (pendingUserInputRequest != nil || store.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)))
            .accessibilityLabel(store.isEndingOperation ? "正在结束当前操作" : store.isRecovering ? "正在恢复对话" : store.isResponding ? "停止生成" : "发送消息")
        }
        .padding(6)
        .modifier(ConversationComposerGlass(reduceTransparency: reduceTransparency))
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 12)
    }
}

struct ConversationMessageBubble: View {
    let message: ConversationMessage
    var personalized = false
    let retry: () -> Void

    private var legacyMedia: LegacyConversationMedia {
        LegacyConversationMedia.extract(from: message.text)
    }

    private var displayedMedia: [PresentedMedia] {
        mergePresentedMedia(message.media, legacyMedia.items)
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            if message.role == .user { Spacer(minLength: 24) }
            if message.role == .assistant {
                ConversationAvatar(isFanto: true, personalized: personalized)
            }

            VStack(alignment: .leading, spacing: 8) {
                if message.role == .assistant, !message.streamBlocks.isEmpty {
                    streamedContent
                } else {
                    messageText
                    activities
                }
                if message.role == .assistant {
                    ConversationMediaPresentation(items: displayedMedia)
                }
                stateText
            }
            .padding(.vertical, 4)
            .frame(maxWidth: .infinity, alignment: message.role == .user ? .trailing : .leading)

            if message.role == .user {
                ConversationAvatar(isFanto: false)
            }
            if message.role == .assistant { Spacer(minLength: 8) }
        }
        .frame(maxWidth: .infinity, alignment: message.role == .user ? .trailing : .leading)
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var streamedContent: some View {
        ForEach(Array(message.streamBlocks.enumerated()), id: \.offset) { _, block in
            switch block {
            case let .text(text):
                MarkdownContentView(markdown: LegacyConversationMedia.extract(from: text).markdown, leadingTitleToOmit: nil)
            case let .activity(id):
                if let activity = message.activities.first(where: { $0.id == id }) {
                    ConversationActivityRow(activity: activity)
                }
            }
        }
    }

    @ViewBuilder
    private var messageText: some View {
        if message.role == .assistant {
            if legacyMedia.markdown.isEmpty,
               message.state == .waiting || message.state == .processing || message.state == .streaming {
                HStack(spacing: 8) {
                    ProgressView()
                    Text("正在回想…")
                        .foregroundStyle(.secondary)
                }
            } else if !legacyMedia.markdown.isEmpty {
                MarkdownContentView(markdown: legacyMedia.markdown, leadingTitleToOmit: nil)
            }
        } else {
            if let response = message.userInputResponse {
                UserInputResponseCard(response: response)
            } else {
                Text(message.text)
                    .textSelection(.enabled)
                    .foregroundStyle(.primary)
            }
        }
    }

    @ViewBuilder
    private var activities: some View {
        if message.role == .assistant, !message.activities.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(message.activities) { activity in
                    ConversationActivityRow(activity: activity)
                }
            }
        }
    }

    @ViewBuilder
    private var stateText: some View {
        switch message.state {
        case .stopped:
            Text("已停止生成")
                .font(.caption)
                .foregroundStyle(.secondary)
        case let .failed(error):
            VStack(alignment: .leading, spacing: 6) {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Button("重新发送", action: retry)
                    .font(.caption.weight(.semibold))
            }
        case .complete, .waiting, .processing, .streaming:
            EmptyView()
        }
    }
}

private struct ConversationActivityRow: View {
    let activity: ConversationToolActivity

    var body: some View {
        HStack(spacing: 8) {
            if activity.state == .inProgress {
                ProgressView()
                    .controlSize(.small)
            } else {
                Image(systemName: activity.state == .succeeded ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                    .foregroundStyle(activity.state == .succeeded ? .green : .orange)
            }
            Text(activity.text)
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityLabel(activity.text)
    }
}

private struct UserInputResponseCard: View {
    let response: FantoUserInputResponse

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Label("已提交表单", systemImage: "checkmark.circle.fill")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            Text(response.content)
                .font(.subheadline)
                .textSelection(.enabled)
                .foregroundStyle(.primary)
        }
    }
}
