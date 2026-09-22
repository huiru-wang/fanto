import SwiftUI

struct FantoConversationView: View {
    @Bindable var store: ConversationStore

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
            .task { await store.load() }
        }
    }

    private var conversation: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 14) {
                    if store.messages.isEmpty {
                        welcome
                    } else {
                        ForEach(store.messages) { message in
                            ConversationMessageBubble(message: message) {
                                store.retryLastMessage()
                            }
                            .id(message.id)
                        }
                    }
                }
                .padding(.horizontal)
                .padding(.vertical, 18)
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                composer
            }
            .onChange(of: store.scrollAnchorID) { _, anchor in
                guard let anchor else { return }
                withAnimation(.easeOut(duration: 0.18)) {
                    proxy.scrollTo(anchor, anchor: .bottom)
                }
            }
        }
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
            TextField("和 Fanto 聊聊", text: $store.draft, axis: .vertical)
                .lineLimit(1 ... 5)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(.thinMaterial, in: Capsule())
                .accessibilityLabel("输入消息")

            Button {
                if store.isResponding {
                    store.stop()
                } else {
                    store.send()
                }
            } label: {
                Image(systemName: store.isResponding ? "stop.fill" : "arrow.up")
                    .font(.headline)
                    .frame(width: 44, height: 44)
                    .foregroundStyle(.white)
                    .background(store.isResponding || !store.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? FantoTheme.accent : Color.secondary, in: Circle())
            }
            .disabled(!store.isResponding && store.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            .accessibilityLabel(store.isResponding ? "停止生成" : "发送消息")
        }
        .padding(.horizontal)
        .padding(.vertical, 10)
        .background(.bar)
    }
}

private struct ConversationMessageBubble: View {
    let message: ConversationMessage
    let retry: () -> Void

    private var legacyMedia: LegacyConversationMedia {
        LegacyConversationMedia.extract(from: message.text)
    }

    private var displayedMedia: [PresentedMedia] {
        mergePresentedMedia(message.media, legacyMedia.items)
    }

    var body: some View {
        HStack {
            if message.role == .user { Spacer(minLength: 54) }

            VStack(alignment: .leading, spacing: 8) {
                messageText
                if message.role == .assistant {
                    ConversationMediaPresentation(items: displayedMedia)
                }
                stateText
            }
            .padding(14)
            .background(background, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .frame(maxWidth: .infinity, alignment: message.role == .user ? .trailing : .leading)

            if message.role == .assistant { Spacer(minLength: 54) }
        }
        .frame(maxWidth: .infinity, alignment: message.role == .user ? .trailing : .leading)
        .accessibilityElement(children: .combine)
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
            Text(message.text)
                .textSelection(.enabled)
                .foregroundStyle(.white)
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

    private var background: Color {
        message.role == .user ? FantoTheme.accent : Color(uiColor: .secondarySystemBackground)
    }
}
