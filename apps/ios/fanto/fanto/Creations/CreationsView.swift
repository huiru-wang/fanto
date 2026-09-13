import SwiftUI

struct CreationsView: View {
    @Environment(FantoStore.self) private var store
    @State private var proposalForDetail: Proposal?

    var body: some View {
        NavigationStack {
            Group {
                switch store.creationLoadState {
                case .idle, .loading:
                    ProgressView("正在读取脉络")
                case let .failed(message):
                    VStack(spacing: 16) {
                        ContentUnavailableView("暂时无法读取脉络", systemImage: "wifi.exclamationmark", description: Text(message))
                        Button("重新加载") {
                            Task { await store.loadCreations() }
                        }
                    }
                case .loaded:
                    content
                }
            }
            .navigationDestination(for: Creation.self, destination: CreationDetailView.init)
            .sheet(item: $proposalForDetail, content: ProposalDetailView.init)
            .alert("操作未完成", isPresented: Binding(
                get: { store.proposalActionError != nil },
                set: { if !$0 { store.proposalActionError = nil } }
            )) {
                Button("好", role: .cancel) { store.proposalActionError = nil }
            } message: {
                Text(store.proposalActionError ?? "请稍后重试。")
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        if store.proposals.isEmpty && store.creations.isEmpty && store.creationKinds.isEmpty {
            ContentUnavailableView("还没有脉络", systemImage: "point.3.connected.trianglepath.dotted", description: Text("当一些记录彼此呼应时，新的脉络便会在这里长出来。"))
        } else {
            List {
                proposalSection
                trackingSection
                kindSection
            }
            .listStyle(.insetGrouped)
            .refreshable {
                await store.loadCreations()
            }
        }
    }

    @ViewBuilder
    private var proposalSection: some View {
        if !store.proposals.isEmpty {
            Section("等待你的确认") {
                ProposalDeckView(proposals: store.proposals, onDetail: showDetail)
                    .listRowInsets(EdgeInsets(top: 8, leading: 0, bottom: 6, trailing: 0))
                    .listRowBackground(Color.clear)
            }
        }
    }

    @ViewBuilder
    private var trackingSection: some View {
        if !store.creations.isEmpty {
            Section {
                ForEach(store.creations) { creation in
                    NavigationLink(value: creation) {
                        CreationRow(creation: creation)
                    }
                }
            } header: {
                Text("继续跟踪")
            } footer: {
                Text("按最近更新展示最多三条仍在跟踪中的脉络。")
            }
        }
    }

    @ViewBuilder
    private var kindSection: some View {
        if !store.creationKinds.isEmpty {
            Section {
                ForEach(store.creationKinds) { kind in
                    NavigationLink {
                        CreationKindListView(kind: kind)
                    } label: {
                        Label(kind.title, systemImage: kind.symbol)
                            .foregroundStyle(FantoTheme.accent)
                    }
                }
            } header: {
                Text("更多")
            } footer: {
                Text("类型随你的脉络自然出现。")
            }
        }
    }

    private func showDetail(_ proposal: Proposal) {
        proposalForDetail = proposal
    }
}

#Preview {
    CreationsView()
        .environment(FantoStore.preview)
}
