import SwiftUI

struct ProposalDeckSlot: View {
    let proposal: Proposal
    let depth: Int
    let stackCount: Int
    let dragTranslation: CGSize
    let isHorizontalDrag: Bool
    let decisionThreshold: CGFloat
    let reduceMotion: Bool
    let stackSpacing: CGFloat
    let onDetail: () -> Void

    var body: some View {
        Button(action: onDetail) {
            ZStack {
                ProposalCard(proposal: proposal)
                if isForeground && isHorizontalDrag {
                    ProposalSwipeFeedbackView(
                        horizontalTranslation: dragTranslation.width,
                        threshold: decisionThreshold
                    )
                }
            }
        }
        .buttonStyle(.plain)
        .allowsHitTesting(isForeground)
        .offset(
            x: isForeground && isHorizontalDrag ? dragTranslation.width : 0,
            y: verticalOffset
        )
        .scaleEffect(cardScale)
        .rotationEffect(
            reduceMotion || !isForeground || !isHorizontalDrag
                ? .zero
                : .degrees(Double(dragTranslation.width / 35))
        )
        .zIndex(Double(stackCount - depth))
        .accessibilityHidden(!isForeground)
    }

    private var isForeground: Bool { depth == 0 }

    private var swipeProgress: CGFloat {
        guard isHorizontalDrag else { return 0 }
        return min(abs(dragTranslation.width) / decisionThreshold, 1)
    }

    private var verticalOffset: CGFloat {
        let stackedOffset = CGFloat(depth) * stackSpacing
        if depth == 1 {
            return stackedOffset * (1 - swipeProgress)
        }
        if isForeground && !isHorizontalDrag {
            return dragTranslation.height
        }
        return stackedOffset
    }

    private var cardScale: CGFloat {
        guard !reduceMotion else { return 1 }
        let baseScale = 1 - (CGFloat(depth) * 0.04)
        if depth == 1 {
            return baseScale + ((1 - baseScale) * swipeProgress)
        }
        return baseScale
    }
}
