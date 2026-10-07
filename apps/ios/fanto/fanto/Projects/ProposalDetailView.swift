import SwiftUI

struct ProposalDetailView: View {
    let proposal: Proposal
    @Environment(FantoStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var detail: Proposal?
    @State private var records: [Record] = []
    @State private var nextCursor: String?
    @State private var errorMessage: String?
    @State private var isLoading = false
    @State private var isDeciding = false
    private var displayedProposal: Proposal { detail ?? proposal }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Text(displayedProposal.title).font(.title).bold()
                Label(displayedProposal.type == .create ? "新的创作建议" : "继续创作", systemImage: "sparkles")
                    .font(.caption).foregroundStyle(.secondary)
                Text("为什么适合").font(.headline)
                MarkdownContentView(markdown: displayedProposal.content.reason, leadingTitleToOmit: nil)
                Text("创作思路").font(.headline)
                MarkdownContentView(markdown: displayedProposal.content.idea, leadingTitleToOmit: nil)
                if !displayedProposal.content.plan.isEmpty {
                    Text("创作计划").font(.headline)
                    ForEach(Array(displayedProposal.content.plan.enumerated()), id: \.offset) { index, step in
                        HStack(alignment: .top, spacing: 12) {
                            Text("\(index + 1)").foregroundStyle(.secondary)
                            MarkdownContentView(markdown: step, leadingTitleToOmit: nil)
                        }
                    }
                }
                if !records.isEmpty {
                    Divider()
                    Text("参考记录").font(.headline)
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(records) { record in
                            ProjectRecordTimelineRow(record: record, showsLineAfter: record.id != records.last?.id)
                        }
                    }
                }
                if nextCursor != nil {
                    Button("更多参考记录") { Task { await loadRecords(append: true) } }.disabled(isLoading)
                }
                if let errorMessage {
                    Text(errorMessage).foregroundStyle(.secondary)
                    Button("重新加载") { Task { await load() } }
                }
            }.padding()
        }
        .navigationTitle("创作提议")
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom) {
            if displayedProposal.status == .pending {
                HStack {
                    Button("不感兴趣", systemImage: "xmark") { Task { await decide(accept: false) } }.buttonStyle(.bordered)
                    Spacer()
                    Button("接受提议", systemImage: "heart") { Task { await decide(accept: true) } }.buttonStyle(.borderedProminent)
                }.disabled(isDeciding).padding().background(.bar)
            }
        }
        .task(id: proposal.id) { await load() }
    }
    private func load() async {
        do { detail = try await FantoAPIClient.shared.fetchProposal(id: proposal.id) }
        catch { errorMessage = error.localizedDescription; return }
        await loadRecords(append: false)
    }
    private func loadRecords(append: Bool) async {
        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let page = try await FantoAPIClient.shared.fetchProposalRecords(id: proposal.id, cursor: append ? nextCursor : nil)
            var seen = Set<String>()
            records = ((append ? records : []) + page.records).filter { seen.insert($0.id).inserted }
            nextCursor = page.hasMore ? page.nextCursor : nil
            errorMessage = nil
        } catch { errorMessage = error.localizedDescription }
    }
    private func decide(accept: Bool) async {
        guard !isDeciding else { return }
        isDeciding = true
        defer { isDeciding = false }
        let succeeded = accept ? await store.accept(displayedProposal) : await store.decline(displayedProposal)
        if succeeded { dismiss() }
    }
}
