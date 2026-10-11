import SwiftUI

struct ProposalDeckView: View {
    let proposals: [Proposal]

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var selectedID: Proposal.ID?
    @State private var direction = 1
    @GestureState private var dragY: Double = 0

    private var index: Int {
        proposals.firstIndex { $0.id == selectedID } ?? 0
    }

    private var settling: Animation {
        reduceMotion ? .easeOut(duration: 0.15) : .spring(duration: 0.38, bounce: 0.12)
    }

    private var dragOffset: Double {
        let atBoundary = (index == 0 && dragY > 0) || (index == proposals.count - 1 && dragY < 0)
        return dragY * (atBoundary ? 0.15 : 0.65)
    }

    var body: some View {
        if !proposals.isEmpty {
            VStack(spacing: 20) {
                cardStack
                if proposals.count > 1 {
                    HStack(spacing: 16) {
                        switchButton("上一张提议", symbol: "chevron.up", step: -1)
                        Spacer(minLength: 0)
                        VStack(spacing: 3) {
                            Text("\(index + 1) / \(proposals.count)")
                                .font(.subheadline.monospacedDigit().weight(.medium))
                                .contentTransition(.numericText())
                            Text(typeSize.isAccessibilitySize ? "使用按钮切换提议" : "上下滑动切换提议")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel("第 \(index + 1) 张，共 \(proposals.count) 张提议")
                        Spacer(minLength: 0)
                        switchButton("下一张提议", symbol: "chevron.down", step: 1)
                    }
                    .padding(.horizontal, 12)
                }
            }
            .padding(.top, 2)
            .padding(.bottom, 8)
            .sensoryFeedback(.selection, trigger: selectedID)
            .onAppear { if selectedID == nil { selectedID = proposals.first?.id } }
            .onChange(of: proposals.map(\.id)) { oldIDs, newIDs in
                guard let selectedID else {
                    self.selectedID = newIDs.first
                    return
                }
                guard !newIDs.contains(selectedID) else { return }
                let previousIndex = oldIDs.firstIndex(of: selectedID) ?? 0
                self.selectedID = newIDs.isEmpty ? nil : newIDs[min(previousIndex, newIDs.count - 1)]
            }
        }
    }

    private var cardStack: some View {
        NavigationLink(value: proposals[index]) {
            ProposalCardView(proposal: proposals[index])
                .id(proposals[index].id)
                .transition(reduceMotion ? .opacity : .asymmetric(
                    insertion: .offset(y: Double(direction) * 50).combined(with: .opacity),
                    removal: .offset(y: Double(direction) * -70).combined(with: .opacity)
                ))
        }
        .buttonStyle(.plain)
        .navigationLinkIndicatorVisibility(.hidden)
        .background {
            // Back plates convey remaining cards without exposing another tappable proposal.
            ForEach((1...2).reversed(), id: \.self) { depth in
                if index + depth < proposals.count {
                    RoundedRectangle(cornerRadius: 26, style: .continuous)
                        .fill(Color(uiColor: .secondarySystemGroupedBackground))
                        .overlay {
                            RoundedRectangle(cornerRadius: 26, style: .continuous)
                                .strokeBorder(Color.primary.opacity(contrast == .increased ? 0.25 : 0.06), lineWidth: 1)
                        }
                        .scaleEffect(x: 1 - Double(depth) * 0.045, y: 1, anchor: .bottom)
                        .offset(y: Double(depth) * 9)
                }
            }
        }
        .offset(y: reduceMotion ? 0 : dragOffset)
        .rotationEffect(.degrees(reduceMotion ? 0 : max(-1.5, min(1.5, dragOffset / 60))))
        .padding(.bottom, proposals.count > 1 ? 18 : 0)
        .accessibilityHint("轻点查看提议详情")
        .accessibilityAction(named: "下一张提议") { switchCard(by: 1) }
        .accessibilityAction(named: "上一张提议") { switchCard(by: -1) }
        // Vertical dragging browses cards; at accessibility sizes it scrolls long content instead.
        .highPriorityGesture(
            DragGesture(minimumDistance: 20)
                .updating($dragY) { value, state, transaction in
                    guard abs(value.translation.height) > abs(value.translation.width) else { return }
                    transaction.animation = nil
                    state = value.translation.height
                }
                .onEnded { value in
                    guard abs(value.translation.height) > abs(value.translation.width) else { return }
                    let projected = value.predictedEndTranslation.height
                    if value.translation.height < -55 || projected < -130 {
                        switchCard(by: 1)
                    } else if value.translation.height > 55 || projected > 130 {
                        switchCard(by: -1)
                    }
                },
            including: proposals.count > 1 && !typeSize.isAccessibilitySize ? .all : .none
        )
        .animation(settling, value: dragY == 0)
    }

    private func switchButton(_ title: String, symbol: String, step: Int) -> some View {
        Button(title, systemImage: symbol) { switchCard(by: step) }
            .labelStyle(.iconOnly)
            .font(.subheadline.weight(.semibold))
            .frame(width: 44, height: 44)
            .background(Color(uiColor: .secondarySystemGroupedBackground), in: Circle())
            .disabled(!proposals.indices.contains(index + step))
    }

    private func switchCard(by step: Int) {
        let next = index + step
        guard proposals.indices.contains(next) else { return }
        direction = step
        withAnimation(settling) { selectedID = proposals[next].id }
    }
}
