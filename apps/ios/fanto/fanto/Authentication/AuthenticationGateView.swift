import SwiftUI

struct AuthenticationGateView: View {
    @Environment(FantoStore.self) private var fantoStore
    @State private var auth = AuthenticationStore.shared

    var body: some View {
        Group {
            switch auth.state {
            case .restoring:
                restoringView
            case .signedOut:
                AuthenticationEntryView(auth: auth)
            case .signedIn:
                AppRootView()
                    .task {
                        async let records: Void = fantoStore.loadRecords()
                        async let creations: Void = fantoStore.loadCreations()
                        _ = await (records, creations)
                    }
            }
        }
        .task { await auth.restore() }
        .onReceive(NotificationCenter.default.publisher(for: .fantoAuthSessionInvalidated)) { _ in
            fantoStore.resetUserData()
            auth.invalidateSession()
        }
        .onChange(of: auth.state) { oldValue, newValue in
            if case .signedIn = oldValue, case .signedOut = newValue {
                fantoStore.resetUserData()
            }
        }
    }

    private var restoringView: some View {
        VStack(spacing: 16) {
            ProgressView()
            Text("正在恢复登录状态")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemBackground))
    }
}
