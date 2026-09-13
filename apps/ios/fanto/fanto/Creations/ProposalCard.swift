import SwiftUI

struct ProposalCard: View {
    let proposal: Proposal

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Label(proposal.kind.title, systemImage: proposal.kind.symbol)
                    .font(.subheadline)
                    .foregroundStyle(tint)
                Spacer()
                if proposal.sourceCount > 0 {
                    Text("基于 \(proposal.sourceCount) 条记录")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Spacer(minLength: 8)

            VStack(alignment: .leading, spacing: 10) {
                Text(proposal.title)
                    .font(.title3)
                    .bold()
                    .fixedSize(horizontal: false, vertical: true)
                Text(proposal.insight)
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .lineLimit(5)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 8)
        }
        .padding(20)
        .frame(maxWidth: .infinity, minHeight: 250, alignment: .leading)
        .background {
            RoundedRectangle(cornerRadius: FantoTheme.cardRadius)
                .fill(Color(uiColor: .systemBackground))
        }
        .overlay {
            RoundedRectangle(cornerRadius: FantoTheme.cardRadius)
                .stroke(tint.opacity(0.8), lineWidth: 1.5)
        }
    }

    private var tint: Color {
        if proposal.kind == .thread { return .indigo }
        if proposal.kind == .research { return .teal }
        return FantoTheme.accent
    }
}
