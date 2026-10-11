import SwiftUI

struct ProposalCardView: View {
    let proposal: Proposal

    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.dynamicTypeSize) private var typeSize

    private var title: String {
        proposal.content.ideas.count == 1 ? (proposal.content.ideas.first?.title ?? proposal.title) : proposal.title
    }

    private var opening: String? {
        if let opening = proposal.content.opening, !opening.isEmpty { return opening }
        return proposal.content.ideas.count == 1 ? proposal.content.ideas.first?.idea : nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Label(proposal.type == .create ? "新的可能" : "延续脉络", systemImage: "sparkles")
                .font(.caption.weight(.medium))
                .foregroundStyle(.secondary)

            Text(title)
                .font(.title3.weight(.semibold))
                .foregroundStyle(.primary)
                .fixedSize(horizontal: false, vertical: true)

            if let opening {
                Text(opening)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(typeSize.isAccessibilitySize ? nil : 4)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if proposal.content.ideas.count > 1 {
                VStack(alignment: .leading, spacing: 6) {
                    Text("\(proposal.content.ideas.count) 个创意方向")
                        .font(.caption.weight(.medium))
                    Text(proposal.content.ideas.map(\.title).joined(separator: " · "))
                        .font(.caption)
                        .lineLimit(typeSize.isAccessibilitySize ? nil : 2)
                }
                .foregroundStyle(.secondary)
            }

            HStack {
                Text("查看提议")
                Spacer()
                Image(systemName: "arrow.up.right")
            }
            .font(.subheadline.weight(.medium))
            .foregroundStyle(.tint)
            .padding(.top, 4)
        }
        .padding(24)
        .frame(maxWidth: .infinity, minHeight: 250, alignment: .leading)
        .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 26, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 26, style: .continuous)
                .strokeBorder(Color.primary.opacity(contrast == .increased ? 0.25 : 0.05), lineWidth: 1)
        }
        .shadow(color: .black.opacity(0.04), radius: 12, x: 0, y: 6)
        .contentShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
