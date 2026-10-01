import SwiftUI

struct ProjectDetailView: View {
    let project: Project
    @Environment(FantoStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var detail: Project?
    @State private var records: [Record] = []
    @State private var nextCursor: String?
    @State private var hasMoreRecords = false
    @State private var isLoadingMoreRecords = false
    @State private var errorMessage: String?

    private var displayedProject: Project { detail ?? project }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Text(displayedProject.title)
                    .font(.title)
                    .bold()
                    .fixedSize(horizontal: false, vertical: true)
                Text("\(displayedProject.status.title) · \(FantoDateText.timestamp(displayedProject.updatedAt))")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                if !displayedProject.content.isEmpty {
                    MarkdownContentView(markdown: displayedProject.content, leadingTitleToOmit: displayedProject.title)
                }

                recordSection

                if let errorMessage {
                    ContentUnavailableView("部分内容未能加载", systemImage: "exclamationmark.triangle", description: Text(errorMessage))
                }
            }
            .padding()
        }
        .navigationTitle("脉络")
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom) {
            if displayedProject.status == .proposed {
                HStack {
                    Button("暂不保留", systemImage: "xmark") {
                        Task { if await store.decline(project) { dismiss() } }
                    }
                    .buttonStyle(.bordered)
                    .tint(.secondary)
                    Spacer()
                    Button("长期跟踪", systemImage: "checkmark") {
                        Task { if await store.accept(project) { dismiss() } }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(FantoTheme.accent)
                }
                .padding()
                .background(.bar)
            }
        }
        .task(id: project.id) { await loadInitialContent() }
    }

    @ViewBuilder
    private var recordSection: some View {
        if !records.isEmpty {
            Divider()
            Text("相关记录")
                .font(.headline)
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(records) { record in
                    ProjectRecordTimelineRow(record: record, showsLineAfter: record.id != records.last?.id)
                    if record.id == records.last?.id, hasMoreRecords {
                        Button {
                            Task { await loadMoreRecords() }
                        } label: {
                            if isLoadingMoreRecords { ProgressView() } else { Text("更多") }
                        }
                        .buttonStyle(.bordered)
                        .disabled(isLoadingMoreRecords)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                    }
                }
            }
        }
    }

    private func loadInitialContent() async {
        do {
            async let loadedDetail = FantoAPIClient.shared.fetchProject(id: project.id)
            async let firstPage = FantoAPIClient.shared.fetchProjectRecords(id: project.id)
            detail = try await loadedDetail
            apply(try await firstPage, append: false)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func loadMoreRecords() async {
        guard let nextCursor, !isLoadingMoreRecords else { return }
        isLoadingMoreRecords = true
        defer { isLoadingMoreRecords = false }
        do {
            apply(try await FantoAPIClient.shared.fetchProjectRecords(id: project.id, cursor: nextCursor), append: true)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func apply(_ page: ProjectRecordPage, append: Bool) {
        records = append ? records + page.records : page.records
        hasMoreRecords = page.hasMore
        nextCursor = page.nextCursor
    }
}
