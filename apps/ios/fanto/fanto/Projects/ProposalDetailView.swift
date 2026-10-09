import SwiftUI

struct ProposalDetailView: View {
    let proposal: Proposal

    @Environment(FantoStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var detail: Proposal?
    @State private var selectedIdeaID: String?
    @State private var destination: Project?
    @State private var records: [Record] = []
    @State private var nextCursor: String?
    @State private var errorMessage: String?
    @State private var referenceError: String?
    @State private var isLoadingReferences = false
    @State private var isReferencesExpanded = false
    @State private var isDeciding = false

    private var current: Proposal { detail ?? proposal }
    private var referenceCount: Int { current.referenceRecordCount ?? records.count }
    private var resolvedSelection: String? { current.status == .accepted ? current.content.selectedIdeaId : selectedIdeaID }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                VStack(alignment: .leading, spacing: 8) {
                    Text(current.type == .extend ? "延续已有脉络" : "新的提议")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.secondary)
                    Text(current.title)
                        .font(.largeTitle.weight(.bold))
                        .fixedSize(horizontal: false, vertical: true)
                }
                VStack(spacing: 12) {
                    ForEach(current.content.ideas) { idea in
                        ideaCard(idea)
                    }
                }
                referencesSection
                if let errorMessage {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(errorMessage).font(.footnote).foregroundStyle(.red)
                        Button("重新加载") { Task { await load() } }
                    }
                    .accessibilityElement(children: .combine)
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 12)
            .padding(.bottom, 30)
        }
        .navigationTitle(current.type == .extend ? "脉络更新" : "新提议")
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom) { actionBar }
        .task(id: proposal.id) { await load() }
        .navigationDestination(item: $destination) { project in
            ProjectDetailView(project: project)
        }
    }

    private func ideaCard(_ idea: ProposalIdea) -> some View {
        let checked = resolvedSelection == idea.id
        return Button {
            if current.status == .pending && !isDeciding { selectedIdeaID = idea.id }
        } label: {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    Text(idea.title)
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(.primary)
                    Spacer(minLength: 8)
                    Image(systemName: checked ? "checkmark.circle.fill" : "circle")
                        .foregroundStyle(checked ? Color.accentColor : Color.secondary)
                        .font(.title3)
                }
                Text(idea.idea)
                    .font(.body)
                    .foregroundStyle(.primary)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 72), spacing: 7, alignment: .leading)], alignment: .leading, spacing: 7) {
                    ForEach(idea.tags, id: \.self) { tag in
                        Text(tag)
                            .font(.caption.weight(.medium))
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(.secondary.opacity(0.10), in: Capsule())
                    }
                }
            }
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(checked ? Color.accentColor.opacity(0.065) : Color.secondary.opacity(0.04),
                        in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(checked ? Color.accentColor : Color.secondary.opacity(0.16), lineWidth: checked ? 2 : 1))
        }
        .buttonStyle(.plain)
        .disabled(current.status != .pending || isDeciding)
        .accessibilityLabel("\(idea.title)，\(idea.idea)，\(idea.tags.joined(separator: "、"))")
        .accessibilityValue(checked ? "已选择" : "未选择")
        .accessibilityHint(current.status == .pending ? "双击确认这个方向" : "已确认的创意，仅供查看")
    }

    private var referencesSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Divider()
            Button {
                withAnimation(.snappy) { isReferencesExpanded.toggle() }
                if isReferencesExpanded && records.isEmpty && referenceCount > 0 {
                    Task { await loadRecords(append: false) }
                }
            } label: {
                HStack {
                    Label(referenceCount > 0 ? "参考记录 · \(referenceCount) 条" : "参考记录", systemImage: "clock.arrow.circlepath")
                    Spacer()
                    if isLoadingReferences { ProgressView().controlSize(.small) }
                    else { Image(systemName: isReferencesExpanded ? "chevron.up" : "chevron.down") }
                }
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.primary)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityValue(isReferencesExpanded ? "已展开" : "已折叠")
            if isReferencesExpanded {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(records) { record in
                        ProjectRecordTimelineRow(record: record, showsLineAfter: record.id != records.last?.id)
                    }
                }
                if nextCursor != nil {
                    Button("更多参考记录") { Task { await loadRecords(append: true) } }
                        .disabled(isLoadingReferences)
                }
                if let referenceError {
                    Text(referenceError).font(.footnote).foregroundStyle(.secondary)
                    Button("重新加载参考记录") { Task { await loadRecords(append: false) } }
                }
            }
        }
    }

    @ViewBuilder
    private var actionBar: some View {
        if current.status == .pending {
            HStack(spacing: 12) {
                Button("不感兴趣") { Task { await decide(accept: false) } }
                    .buttonStyle(.bordered).frame(maxWidth: .infinity)
                Button(isDeciding ? "正在提交…" : (current.type == .extend ? "更新这个项目" : "按这个方向创作")) { Task { await decide(accept: true) } }
                    .buttonStyle(.borderedProminent).frame(maxWidth: .infinity)
                    .disabled(resolvedSelection == nil)
            }
            .disabled(isDeciding)
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
            .background(.bar)
        } else if current.status == .accepted {
            Button("查看作品") { Task { await openAcceptedProject() } }
                .buttonStyle(.borderedProminent)
                .disabled(current.resultProjectID == nil || isDeciding)
                .frame(maxWidth: .infinity)
                .padding(14)
                .background(.bar)
        }
    }

    private func load() async {
        do {
            let loaded = try await FantoAPIClient.shared.fetchProposal(id: proposal.id)
            detail = loaded
            if loaded.status == .accepted { selectedIdeaID = loaded.content.selectedIdeaId }
            else if loaded.content.ideas.count == 1 { selectedIdeaID = loaded.content.ideas.first?.id }
            else if !loaded.content.ideas.contains(where: { $0.id == selectedIdeaID }) { selectedIdeaID = nil }
            errorMessage = nil
        } catch { errorMessage = error.localizedDescription }
    }

    private func loadRecords(append: Bool) async {
        guard !isLoadingReferences else { return }
        isLoadingReferences = true
        defer { isLoadingReferences = false }
        do {
            let page = try await FantoAPIClient.shared.fetchProposalRecords(id: proposal.id, cursor: append ? nextCursor : nil)
            var seen = Set<String>()
            records = ((append ? records : []) + page.records).filter { seen.insert($0.id).inserted }
            nextCursor = page.hasMore ? page.nextCursor : nil
            referenceError = nil
        } catch { referenceError = error.localizedDescription }
    }

    private func openAcceptedProject() async {
        guard let projectID = current.resultProjectID, !isDeciding else { return }
        isDeciding = true
        defer { isDeciding = false }
        do {
            destination = try await FantoAPIClient.shared.fetchProject(id: projectID).project
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func decide(accept: Bool) async {
        guard !isDeciding else { return }
        if accept && resolvedSelection == nil { return }
        isDeciding = true
        defer { isDeciding = false }
        if accept {
            if let project = await store.accept(current, selectedIdeaId: resolvedSelection!) {
                destination = project
                return
            }
        } else if await store.decline(current) {
            dismiss()
            return
        }
        await load()
        errorMessage = store.projectActionError ?? "操作没有完成，请重试。"
    }
}
