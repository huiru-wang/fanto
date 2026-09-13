import SwiftUI

struct ProposalDeckView: View {
    let proposals: [Proposal]
    let onDetail: (Proposal) -> Void
    @Environment(FantoStore.self) private var store
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var currentIndex = 0
    @GestureState private var dragTranslation: CGSize = .zero

    private let decisionThreshold: CGFloat = 110
    private let verticalThreshold: CGFloat = 55
    private let stackSpacing: CGFloat = 12

    private var currentProposal: Proposal {
        proposals[min(currentIndex, proposals.count - 1)]
    }

    private var stackProposals: [Proposal] {
        let count = min(3, proposals.count)
        return (0..<count).map { offset in
            proposals[(currentIndex + offset) % proposals.count]
        }
    }

    private var horizontalDrag: Bool {
        abs(dragTranslation.width) > abs(dragTranslation.height)
    }

    var body: some View {
        VStack(spacing: 14) {
            ZStack {
                ForEach(stackProposals) { proposal in
                    let depth = stackProposals.firstIndex(of: proposal) ?? 0
                    ProposalDeckSlot(
                        proposal: proposal,
                        depth: depth,
                        stackCount: stackProposals.count,
                        dragTranslation: dragTranslation,
                        isHorizontalDrag: horizontalDrag,
                        decisionThreshold: decisionThreshold,
                        reduceMotion: reduceMotion,
                        stackSpacing: stackSpacing,
                        onDetail: { onDetail(proposal) }
                    )
                    .animation(deckAnimation, value: currentIndex)
                }
            }
            .frame(maxWidth: .infinity)
            .highPriorityGesture(deckGesture)
            .accessibilityAction(named: "长期跟踪") { acceptCurrentProposal() }
            .accessibilityAction(named: "暂不保留") { declineCurrentProposal() }
            .accessibilityAction(named: "下一张提案") { advance() }
            .accessibilityAction(named: "上一张提案") { retreat() }

            Text("第 \(currentIndex + 1) 张，共 \(proposals.count) 张")
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.top, 8)
                .frame(maxWidth: .infinity)
        }
        .padding(.horizontal)
        .onChange(of: proposals.count) { _, count in
            currentIndex = min(currentIndex, max(count - 1, 0))
        }
    }

    // A single recognizer classifies a drag before committing: horizontal drags
    // decide the proposal, while vertical drags browse the deck without moving the List.
    private var deckGesture: some Gesture {
        DragGesture(minimumDistance: 12)
            .updating($dragTranslation) { value, state, _ in
                state = value.translation
            }
            .onEnded { value in
                let translation = value.translation
                if abs(translation.width) > abs(translation.height) {
                    if translation.width >= decisionThreshold {
                        acceptCurrentProposal()
                    } else if translation.width <= -decisionThreshold {
                        declineCurrentProposal()
                    }
                } else if abs(translation.height) >= verticalThreshold {
                    if translation.height < 0 {
                        advance()
                    } else {
                        retreat()
                    }
                }
            }
    }

    private func acceptCurrentProposal() {
        let proposal = currentProposal
        Task {
            guard await store.accept(proposal) else { return }
            withAnimation(deckAnimation) {
                currentIndex = min(currentIndex, max(proposals.count - 1, 0))
            }
        }
    }

    private func declineCurrentProposal() {
        let proposal = currentProposal
        Task {
            guard await store.decline(proposal) else { return }
            withAnimation(deckAnimation) {
                currentIndex = min(currentIndex, max(proposals.count - 1, 0))
            }
        }
    }

    private func advance() {
        withAnimation(deckAnimation) {
            currentIndex = (currentIndex + 1) % proposals.count
        }
    }

    private func retreat() {
        withAnimation(deckAnimation) {
            currentIndex = (currentIndex - 1 + proposals.count) % proposals.count
        }
    }

    private var deckAnimation: Animation {
        reduceMotion ? .easeOut(duration: 0.15) : .snappy(duration: 0.28, extraBounce: 0.08)
    }
}
