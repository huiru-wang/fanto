import SwiftUI

struct ProposalDetailView: View {
    let proposal: Proposal

    @Environment(FantoStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var detail: Proposal?
    @State private var records: [Record] = []
    @State private var nextCursor: String?
    @State private var errorMessage: String?
    @State private var referenceError: String?
    @State private var isLoadingReferences = false
    @State private var isReferencesExpanded = false
    @State private var isDeciding = false
    @State private var userInput = ""

    private var displayedProposal: Proposal { detail ?? proposal }
    private var referenceCount: Int { displayedProposal.referenceRecordCount ?? records.count }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                header
                effectSection
                planSection
                if displayedProposal.content.goal != nil {
                    inputSection
                }
                referencesSection

                if let errorMessage {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(errorMessage)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                        Button("重新加载") { Task { await load() } }
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 28)
        }
        .navigationTitle("创作提议")
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom) {
            if displayedProposal.status == .pending {
                actionBar
            }
        }
        .task(id: proposal.id) { await load() }
        .onChange(of: userInput) { _, value in
            if value.count > 500 {
                userInput = String(value.prefix(500))
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(displayedProposal.title)
                .font(.largeTitle.weight(.bold))
                .fixedSize(horizontal: false, vertical: true)

            if !displayedProposal.content.tags.isEmpty {
                LazyVGrid(
                    columns: [GridItem(.adaptive(minimum: 72), spacing: 8, alignment: .leading)],
                    alignment: .leading,
                    spacing: 8
                ) {
                    ForEach(displayedProposal.content.tags, id: \.self) { tag in
                        Text(tag)
                            .font(.caption.weight(.medium))
                            .foregroundStyle(.primary)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(.secondary.opacity(0.10), in: Capsule())
                    }
                }
            }
        }
    }

    private var effectSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("创作效果")
                .font(.headline)

            Text(displayedProposal.content.idea)
                .font(.body)
                .foregroundStyle(.primary)
                .fixedSize(horizontal: false, vertical: true)

            if displayedProposal.content.preserveText != nil || displayedProposal.content.transformText != nil {
                HStack(alignment: .top, spacing: 10) {
                    if let preserve = displayedProposal.content.preserveText {
                        facet(title: "保留", value: preserve, symbol: "equal.circle")
                    }
                    if let transform = displayedProposal.content.transformText {
                        facet(title: "转化", value: transform, symbol: "wand.and.sparkles")
                    }
                }
            }
        }
        .padding(16)
        .background(.secondary.opacity(0.07), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private var planSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("创作计划")
                .font(.headline)

            ForEach(Array(displayedProposal.content.plan.enumerated()), id: \.offset) { index, step in
                let parts = planParts(step)
                HStack(alignment: .top, spacing: 12) {
                    Text("\(index + 1)")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .frame(width: 28, height: 28)
                        .background(.secondary.opacity(0.10), in: Circle())

                    VStack(alignment: .leading, spacing: 3) {
                        Text(parts.title)
                            .font(.subheadline.weight(.semibold))
                        if let detail = parts.detail {
                            Text(detail)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .padding(.top, 3)

                    Spacer(minLength: 0)
                }
            }
        }
    }

    private var inputSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("想再改一点？")
                .font(.headline)

            TextField(
                "比如：不要文字、想更童话一点、色调更温暖……",
                text: $userInput,
                axis: .vertical
            )
            .lineLimit(3...6)
            .textFieldStyle(.plain)
            .padding(14)
            .background(.secondary.opacity(0.07), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
    }

    private var referencesSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Divider()

            Button {
                toggleReferences()
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: "clock.arrow.trianglehead.counterclockwise.rotate.90")
                        .foregroundStyle(.secondary)
                    Text(referenceCount > 0 ? "参考记录 · \(referenceCount) 条" : "参考记录")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.primary)
                    Spacer()
                    if isLoadingReferences {
                        ProgressView()
                            .controlSize(.small)
                    } else {
                        Image(systemName: isReferencesExpanded ? "chevron.up" : "chevron.down")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.tertiary)
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(referenceCount == 0 && detail != nil)

            if isReferencesExpanded {
                if !records.isEmpty {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(records) { record in
                            ProjectRecordTimelineRow(record: record, showsLineAfter: record.id != records.last?.id)
                        }
                    }
                }

                if nextCursor != nil {
                    Button("更多参考记录") {
                        Task { await loadRecords(append: true) }
                    }
                    .disabled(isLoadingReferences)
                }

                if let referenceError {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(referenceError)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                        Button("重新加载参考记录") {
                            Task { await loadRecords(append: false) }
                        }
                    }
                }
            }
        }
    }

    private var actionBar: some View {
        HStack(spacing: 12) {
            Button("不感兴趣") {
                Task { await decide(accept: false) }
            }
            .buttonStyle(.bordered)
            .frame(maxWidth: .infinity)

            Button("创作试试") {
                Task { await decide(accept: true) }
            }
            .buttonStyle(.borderedProminent)
            .frame(maxWidth: .infinity)
        }
        .disabled(isDeciding)
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
        .background(.bar)
    }

    private func facet(title: String, value: String, symbol: String) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Label(title, systemImage: symbol)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            Text(value)
                .font(.caption)
                .foregroundStyle(.primary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(.background.opacity(0.75), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func planParts(_ step: String) -> (title: String, detail: String?) {
        let pieces = step.split(separator: "｜", maxSplits: 1, omittingEmptySubsequences: false)
        guard pieces.count == 2 else { return (step, nil) }
        let title = String(pieces[0]).trimmingCharacters(in: .whitespacesAndNewlines)
        let detail = String(pieces[1]).trimmingCharacters(in: .whitespacesAndNewlines)
        return (title.isEmpty ? step : title, detail.isEmpty ? nil : detail)
    }

    private func load() async {
        do {
            detail = try await FantoAPIClient.shared.fetchProposal(id: proposal.id)
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func toggleReferences() {
        let shouldExpand = !isReferencesExpanded
        withAnimation(.snappy) {
            isReferencesExpanded = shouldExpand
        }
        if shouldExpand && records.isEmpty && referenceCount > 0 {
            Task { await loadRecords(append: false) }
        }
    }

    private func loadRecords(append: Bool) async {
        guard !isLoadingReferences else { return }
        isLoadingReferences = true
        defer { isLoadingReferences = false }

        do {
            let page = try await FantoAPIClient.shared.fetchProposalRecords(
                id: proposal.id,
                cursor: append ? nextCursor : nil
            )
            var seen = Set<String>()
            records = ((append ? records : []) + page.records).filter { seen.insert($0.id).inserted }
            nextCursor = page.hasMore ? page.nextCursor : nil
            referenceError = nil
        } catch {
            referenceError = error.localizedDescription
        }
    }

    private func decide(accept: Bool) async {
        guard !isDeciding else { return }
        isDeciding = true
        defer { isDeciding = false }

        let succeeded = accept
            ? await store.accept(displayedProposal, userInput: userInput)
            : await store.decline(displayedProposal)

        if succeeded { dismiss() }
    }
}
