import SwiftUI

struct ProposalDetailView: View {
    let proposal: Proposal
    @Environment(FantoStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    Label(proposal.kind.title, systemImage: proposal.kind.symbol)
                        .font(.headline)
                        .foregroundStyle(FantoTheme.accent)
                    Text(proposal.title)
                        .font(.largeTitle)
                        .bold()
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Fanto 看见的连接")
                            .font(.headline)
                        Text(proposal.insight)
                            .font(.body)
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        Text("为什么会出现")
                            .font(.headline)
                        Text(proposal.evidence)
                            .foregroundStyle(.secondary)
                    }
                    LabeledContent("如果接受") {
                        Text(proposal.suggestedNextStep)
                            .multilineTextAlignment(.trailing)
                    }
                    .font(.subheadline)
                }
                .padding()
            }
            .navigationTitle("提案")
            .navigationBarTitleDisplayMode(.inline)
            .safeAreaInset(edge: .bottom) {
                HStack {
                    Button("暂不保留", systemImage: "xmark") {
                        store.decline(proposal)
                        dismiss()
                    }
                    .buttonStyle(.bordered)
                    .tint(.secondary)
                    Spacer()
                    Button("长期跟踪", systemImage: "checkmark") {
                        store.accept(proposal)
                        dismiss()
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
        }
    }
}
