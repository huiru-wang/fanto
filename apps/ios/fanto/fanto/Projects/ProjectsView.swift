import SwiftUI

struct ProjectsView: View {
    @Environment(FantoStore.self) private var store

    var body: some View {
        NavigationStack {
            Group {
                switch store.projectLoadState {
                case .idle, .loading:
                    ProgressView("正在读取脉络")
                case let .failed(message):
                    VStack(spacing: 16) {
                        ContentUnavailableView("暂时无法读取脉络", systemImage: "wifi.exclamationmark", description: Text(message))
                        Button("重新加载") { Task { await store.loadProjects() } }
                    }
                case .loaded:
                    content
                }
            }
            .navigationDestination(for: Project.self, destination: ProjectDetailView.init)
            .navigationTitle("脉络")
            .alert("操作未完成", isPresented: Binding(
                get: { store.projectActionError != nil },
                set: { if !$0 { store.projectActionError = nil } }
            )) {
                Button("好", role: .cancel) { store.projectActionError = nil }
            } message: {
                Text(store.projectActionError ?? "请稍后重试。")
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        if store.projects.isEmpty && store.proposedProjects.isEmpty {
            ContentUnavailableView("还没有脉络", systemImage: "point.3.connected.trianglepath.dotted", description: Text("当一些记录彼此呼应时，新的脉络便会在这里长出来。"))
        } else {
            List {
                proposedSection
                if !store.projects.isEmpty {
                    Section("继续跟踪") {
                        ForEach(store.projects) { project in
                            NavigationLink(value: project) { ProjectRow(project: project) }
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .refreshable { await store.loadProjects() }
        }
    }

    @ViewBuilder
    private var proposedSection: some View {
        switch store.proposedProjectLoadState {
        case .idle:
            EmptyView()
        case .loaded where store.proposedProjects.isEmpty:
            EmptyView()
        case .loading:
            Section("等待你的确认") { ProgressView("正在读取建议") }
        case let .failed(message):
            Section("等待你的确认") {
                VStack(alignment: .leading, spacing: 8) {
                    Text(message).font(.caption).foregroundStyle(.secondary)
                    Button("重新加载") { Task { await store.loadProposedProjects() } }
                }
            }
        case .loaded:
            Section("等待你的确认") {
                ForEach(store.proposedProjects) { project in
                    NavigationLink(value: project) { ProjectRow(project: project) }
                }
            }
        }
    }
}

#Preview {
    ProjectsView().environment(FantoStore.preview)
}
