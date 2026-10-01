import SwiftUI
import WebKit

private enum TaskArtifactPreviewLoadState {
    case loading
    case loaded(FantoTaskArtifactPreview)
    case failed(String)
}

struct TaskArtifactRow: View {
    let artifact: FantoTaskArtifact

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: iconName)
                .font(.title3)
                .foregroundStyle(FantoTheme.accent)
                .frame(width: 28)

            VStack(alignment: .leading, spacing: 3) {
                Text(artifact.role == .primary ? "主要成果" : "补充材料")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text(displayName)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.primary)
                    .lineLimit(1)
            }

            Spacer(minLength: 12)

            Text("查看")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(FantoTheme.accent)
            Image(systemName: "chevron.right")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.tertiary)
        }
        .padding(14)
        .background(Color.secondary.opacity(0.09), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .accessibilityLabel("查看\(artifact.role == .primary ? "主要成果" : "补充材料")：\(displayName)")
    }

    private var displayName: String {
        switch artifact.format {
        case .html: "HTML 页面"
        case .markdown: "Markdown 文档"
        case .text: "文本内容"
        case nil: artifact.filename
        }
    }

    private var iconName: String {
        switch artifact.format {
        case .html: "safari"
        case .markdown: "text.document"
        case .text: "doc.plaintext"
        case nil: "doc"
        }
    }
}

struct TaskArtifactPreviewView: View {
    let artifact: FantoTaskArtifact
    let cache: TaskDetailCache
    @State private var loadState: TaskArtifactPreviewLoadState = .loading

    var body: some View {
        Group {
            switch loadState {
            case .loading:
                ProgressView("正在打开成果")
            case let .failed(message):
                ContentUnavailableView("暂时无法打开成果", systemImage: "doc.badge.exclamationmark", description: Text(message))
            case let .loaded(preview):
                previewContent(preview)
            }
        }
        .navigationTitle(previewTitle)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    Task { await load(forceRefresh: true) }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .accessibilityLabel("刷新成果")
            }
        }
        .task(id: artifact.mediaID) { await load(forceRefresh: false) }
    }

    @ViewBuilder
    private func previewContent(_ preview: FantoTaskArtifactPreview) -> some View {
        switch preview.format {
        case .html:
            TaskHTMLPreview(html: preview.content)
                .ignoresSafeArea(edges: .bottom)
        case .markdown:
            ScrollView {
                MarkdownContentView(markdown: preview.content, leadingTitleToOmit: nil)
                    .padding()
            }
        case .text:
            ScrollView {
                Text(preview.content)
                    .font(.body)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding()
            }
        }
    }

    private var previewTitle: String {
        switch artifact.format {
        case .html: "HTML 成果"
        case .markdown: "Markdown 成果"
        case .text: "文本成果"
        case nil: artifact.filename
        }
    }

    @MainActor
    private func load(forceRefresh: Bool) async {
        let userID = AgentAPIClient.shared.userID
        if !forceRefresh, let cached = cache.preview(mediaID: artifact.mediaID, userID: userID) {
            loadState = .loaded(cached)
            return
        }
        loadState = .loading
        do {
            let preview = try await AgentAPIClient.shared.fetchTaskArtifactPreview(mediaID: artifact.mediaID)
            let resolvedContent = await TaskArtifactContentResolver.resolveMediaReferences(in: preview.content)
            let resolvedPreview = FantoTaskArtifactPreview(
                mediaID: preview.mediaID,
                filename: preview.filename,
                mimeType: preview.mimeType,
                format: preview.format,
                content: resolvedContent
            )
            cache.store(resolvedPreview, mediaID: artifact.mediaID, userID: userID)
            loadState = .loaded(resolvedPreview)
        } catch {
            loadState = .failed((error as? LocalizedError)?.errorDescription ?? "请稍后重试。")
        }
    }
}

private enum TaskArtifactContentResolver {
    static func resolveMediaReferences(in content: String) async -> String {
        let mediaIDs = mediaIDs(in: content)
        guard !mediaIDs.isEmpty else { return content }

        var resolved = content
        for mediaID in mediaIDs {
            guard let url = try? await CreationAPIClient.shared.fetchMediaReadURL(id: mediaID) else { continue }
            resolved = resolved.replacingOccurrences(of: "fanto-media://\(mediaID)", with: url.absoluteString)
        }
        return resolved
    }

    private static func mediaIDs(in content: String) -> [String] {
        let pattern = #"fanto-media://([A-Za-z0-9-]+)"#
        guard let expression = try? NSRegularExpression(pattern: pattern) else { return [] }
        let range = NSRange(content.startIndex..., in: content)
        var seen = Set<String>()
        return expression.matches(in: content, range: range).compactMap { match in
            guard let range = Range(match.range(at: 1), in: content) else { return nil }
            let mediaID = String(content[range])
            return seen.insert(mediaID).inserted ? mediaID : nil
        }
    }
}

private struct TaskHTMLPreview: UIViewRepresentable {
    let html: String

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.scrollView.contentInsetAdjustmentBehavior = .automatic
        webView.navigationDelegate = context.coordinator
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        guard context.coordinator.loadedHTML != html else { return }
        context.coordinator.loadedHTML = html
        webView.loadHTMLString(html, baseURL: nil)
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator: NSObject, WKNavigationDelegate {
        var loadedHTML: String?

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
            navigationAction.targetFrame?.isMainFrame == true && navigationAction.navigationType == .linkActivated ? .cancel : .allow
        }
    }
}
