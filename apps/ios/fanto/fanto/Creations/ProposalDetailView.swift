import SwiftUI

struct ProposalDetailView: View {
    let proposal: Proposal
    @Environment(FantoStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var detail: Proposal?
    @State private var errorMessage: String?

    private var displayedProposal: Proposal { detail ?? proposal }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    Text(displayedProposal.title)
                        .font(.largeTitle)
                        .bold()
                    if let createdAt = displayedProposal.createdAt {
                        Text("等待确认 · \(FantoDateText.timestamp(createdAt))")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Text(displayedProposal.insight)
                        .font(.subheadline)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.secondary.opacity(0.10), in: RoundedRectangle(cornerRadius: 12))

                    MarkdownContentView(markdown: displayedProposal.evidence, leadingTitleToOmit: displayedProposal.title)

                    sourceSection

                    if let errorMessage {
                        ContentUnavailableView("部分内容未能加载", systemImage: "exclamationmark.triangle", description: Text(errorMessage))
                    }
                }
                .padding()
            }
            .navigationTitle(displayedProposal.kind.title)
            .navigationBarTitleDisplayMode(.inline)
            .safeAreaInset(edge: .bottom) {
                HStack {
                    Button("暂不保留", systemImage: "xmark") {
                        Task {
                            if await store.decline(proposal) {
                                dismiss()
                            }
                        }
                    }
                    .buttonStyle(.bordered)
                    .tint(.secondary)
                    Spacer()
                    Button("长期跟踪", systemImage: "checkmark") {
                        Task {
                            if await store.accept(proposal) {
                                dismiss()
                            }
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(FantoTheme.accent)
                }
                .padding()
                .background(.bar)
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("关闭", action: dismiss.callAsFunction)
                }
            }
            .task(id: proposal.id) {
                await loadDetail()
            }
        }
    }

    @ViewBuilder
    private var sourceSection: some View {
        if !displayedProposal.sourceRecords.isEmpty {
            Divider()
            Text("来源记录")
                .font(.headline)
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(displayedProposal.sourceRecords) { record in
                    ProposalSourceTimelineRow(
                        record: record,
                        showsLineAfter: record.id != displayedProposal.sourceRecords.last?.id
                    )
                }
            }
        }
    }

    private func loadDetail() async {
        do {
            detail = try await CreationAPIClient.shared.fetchProposal(id: proposal.id)
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
