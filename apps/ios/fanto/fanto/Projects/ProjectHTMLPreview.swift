import SwiftUI
import WebKit

struct ProjectHTMLPreview: View {
    let html: String
    @State private var revision = 0
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ProjectStaticWebView(html: html, revision: revision).frame(height: 460)
                .clipShape(RoundedRectangle(cornerRadius: 12))
            Button("刷新预览", systemImage: "arrow.clockwise") { revision += 1 }.font(.caption)
        }
    }
}
/** The browser parses HTML/CSS itself; only fanto-media requests enter the native media handler. */
private struct ProjectStaticWebView: UIViewRepresentable {
    let html: String
    let revision: Int
    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.defaultWebpagePreferences.allowsContentJavaScript = false
        config.setURLSchemeHandler(ProjectMediaSchemeHandler(), forURLScheme: "fanto-media")
        let view = WKWebView(frame: .zero, configuration: config)
        view.navigationDelegate = context.coordinator
        return view
    }
    func updateUIView(_ view: WKWebView, context: Context) {
        guard context.coordinator.html != html || context.coordinator.revision != revision else { return }
        context.coordinator.html = html; context.coordinator.revision = revision
        let policy = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src fanto-media:; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
        view.loadHTMLString("<html><head><meta http-equiv=\"Content-Security-Policy\" content=\"\(policy)\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><style>body{font:17px -apple-system;margin:16px;overflow-wrap:anywhere}img{max-width:100%;height:auto}</style></head><body>\(html)</body></html>", baseURL: nil)
    }
    func makeCoordinator() -> Coordinator { Coordinator() }
    final class Coordinator: NSObject, WKNavigationDelegate {
        var html: String?
        var revision = -1
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
            // Only the initial in-memory document may navigate. No native message handlers are registered.
            action.navigationType == .other && action.request.url?.absoluteString == "about:blank" ? .allow : .cancel
        }
    }
}
private final class ProjectMediaSchemeHandler: NSObject, WKURLSchemeHandler {
    private var tasks: [ObjectIdentifier: Task<Void, Never>] = [:]
    func webView(_ webView: WKWebView, start urlSchemeTask: any WKURLSchemeTask) {
        let key = ObjectIdentifier(urlSchemeTask)
        tasks[key] = Task { @MainActor in
            defer { tasks[key] = nil }
            do {
                guard let requestedURL = urlSchemeTask.request.url, let id = requestedURL.host,
                      requestedURL.path.isEmpty, UUID(uuidString: id) != nil else { throw FantoAPIError.invalidResponse }
                var data: Data?
                var response: HTTPURLResponse?
                // A failed/expired signed URL gets one fresh URL; no URL is persisted in Project content.
                for _ in 0..<2 {
                    try Task.checkCancellation()
                    let signedURL = try await FantoAPIClient.shared.fetchMediaReadURL(id: id)
                    guard signedURL.scheme == "https" else { throw FantoAPIError.invalidResponse }
                    let session = URLSession(configuration: .ephemeral)
                    defer { session.finishTasksAndInvalidate() }
                    let result = try await session.data(from: signedURL)
                    response = result.1 as? HTTPURLResponse
                    if response?.statusCode == 200 { data = result.0; break }
                }
                try Task.checkCancellation()
                guard let data, let response, response.mimeType?.hasPrefix("image/") == true,
                      response.mimeType != "image/svg+xml" else { throw FantoAPIError.invalidResponse }
                urlSchemeTask.didReceive(URLResponse(url: requestedURL, mimeType: response.mimeType, expectedContentLength: data.count, textEncodingName: nil))
                urlSchemeTask.didReceive(data)
                urlSchemeTask.didFinish()
            } catch {
                if !Task.isCancelled { urlSchemeTask.didFailWithError(error) }
            }
        }
    }
    func webView(_ webView: WKWebView, stop urlSchemeTask: any WKURLSchemeTask) {
        tasks.removeValue(forKey: ObjectIdentifier(urlSchemeTask))?.cancel()
    }
}
