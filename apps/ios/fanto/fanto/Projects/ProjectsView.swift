import SwiftUI

struct ProjectsView: View {
    @Environment(FantoStore.self) private var store
    @Environment(\.scenePhase) private var scenePhase
    @State private var isVisible = false

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
            .navigationDestination(for: Proposal.self, destination: ProposalDetailView.init)
            .navigationTitle("脉络")
        }
        .onAppear { isVisible = true }
        .onDisappear { isVisible = false }
        .task(id: isVisible && scenePhase == .active) {
            guard isVisible && scenePhase == .active else { return }
            if store.projectLoadState != .loaded { await store.loadProjects() }
            var cycle = 0
            while !Task.isCancelled {
                await store.refreshCreativeSuggestions()
                if cycle.isMultiple(of: 3) { await store.refreshActiveProjectStates() }
                cycle += 1
                do { try await Task.sleep(for: .seconds(5)) } catch { return }
            }
        }
        .alert("操作未完成", isPresented: Binding(
            get: { store.projectActionError != nil },
            set: { if !$0 { store.projectActionError = nil } }
        )) {
            Button("好", role: .cancel) { store.projectActionError = nil }
        } message: {
            Text(store.projectActionError ?? "请稍后重试。")
        }
    }

    private var content: some View {
        List {
            proposedSection
            if store.projects.isEmpty && store.proposals.isEmpty && store.proposalLoadState == .loaded {
                Section {
                    ContentUnavailableView("还没有脉络", systemImage: "point.3.connected.trianglepath.dotted", description: Text("当一些记录彼此呼应时，新的脉络便会在这里长出来。"))
                }
            }
            if !store.projects.isEmpty {
                    Section("你的作品") {
                        ForEach(store.projects) { project in
                            NavigationLink(value: project) { ProjectRow(project: project) }
                        }
                    }
                }
                Section {
                    NavigationLink {
                        ArchivedProjectsView()
                    } label: {
                        Label("已归档的作品", systemImage: "archivebox")
                            .foregroundStyle(.secondary)
                    }
                }
            }
        .listStyle(.insetGrouped)
        .refreshable { await store.loadProjects() }
    }

    @ViewBuilder
    private var proposedSection: some View {
        switch store.proposalLoadState {
        case .idle:
            EmptyView()
        case .loaded where store.proposals.isEmpty:
            EmptyView()
        case .loading:
            Section("等待你的确认") { ProgressView("正在读取建议") }
        case let .failed(message):
            Section("等待你的确认") {
                VStack(alignment: .leading, spacing: 8) {
                    Text(message).font(.caption).foregroundStyle(.secondary)
                    Button("重新加载") { Task { await store.loadProposals() } }
                }
            }
        case .loaded:
            Section("等待你的确认") {
                ForEach(store.proposals) { proposal in
                    NavigationLink(value: proposal) {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(proposal.content.ideas.count == 1 ? (proposal.content.ideas.first?.title ?? proposal.title) : proposal.title).font(.headline)
                            if proposal.content.ideas.count == 1, let idea = proposal.content.ideas.first {
                                Text(idea.idea).font(.subheadline).foregroundStyle(.secondary).lineLimit(3)
                            } else {
                                Text("2 个创意方向").font(.subheadline).foregroundStyle(.secondary)
                                Text(proposal.content.ideas.map(\.title).joined(separator: "  ·  ")).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                            }
                            Label(proposal.type == .create ? "新的创作建议" : "继续创作", systemImage: "sparkles").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
    }
}

#Preview {
    ProjectsView().environment(FantoStore.preview)
}

private struct ArchivedProjectsView: View {
    @State private var projects: [Project] = []
    @State private var loading = true
    @State private var error: String?

    var body: some View {
        List {
            if loading {
                ProgressView("正在读取归档作品")
            } else if let error {
                ContentUnavailableView("归档作品加载失败", systemImage: "wifi.exclamationmark", description: Text(error))
            } else if projects.isEmpty {
                ContentUnavailableView("还没有归档作品", systemImage: "archivebox")
            } else {
                ForEach(projects) { project in
                    NavigationLink(value: project) { ProjectRow(project: project) }
                }
            }
        }
        .navigationTitle("已归档")
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        loading = projects.isEmpty
        do {
            var cursor: String?
            var all: [Project] = []
            repeat {
                let page = try await FantoAPIClient.shared.fetchProjects(status: .archived, cursor: cursor)
                all += page.projects
                cursor = page.hasMore ? page.nextCursor : nil
            } while cursor != nil
            projects = all
            error = nil
        } catch { self.error = error.localizedDescription }
        loading = false
    }
}
