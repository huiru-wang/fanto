import SwiftUI

struct CreationDetailView: View {
    let creation: Creation
    @State private var detail: Creation?
    @State private var sourceRecords: [CreationSourceRecord] = []
    @State private var nextCursor: String?
    @State private var hasMoreRecords = false
    @State private var isLoadingMoreRecords = false
    @State private var errorMessage: String?

    private var displayedCreation: Creation { detail ?? creation }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Text(displayedCreation.title)
                    .font(.largeTitle)
                    .bold()
                Text("\(displayedCreation.status.title) · \(FantoDateText.timestamp(displayedCreation.updatedAt))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text(displayedCreation.summary)
                    .font(.subheadline)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.secondary.opacity(0.10), in: RoundedRectangle(cornerRadius: 12))

                if let content = displayedCreation.content {
                    MarkdownContentView(markdown: content, leadingTitleToOmit: displayedCreation.title)
                }

                sourceSection

                if let errorMessage {
                    ContentUnavailableView("部分内容未能加载", systemImage: "exclamationmark.triangle", description: Text(errorMessage))
                }
            }
            .padding()
        }
        .navigationTitle(displayedCreation.kind.title)
        .navigationBarTitleDisplayMode(.inline)
        .task(id: creation.id) {
            await loadInitialContent()
        }
    }

    @ViewBuilder
    private var sourceSection: some View {
        if !sourceRecords.isEmpty {
            Divider()
            Text("来源记录")
                .font(.headline)
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(sourceRecords) { record in
                    CreationSourceTimelineRow(
                        record: record,
                        showsLineAfter: record.id != sourceRecords.last?.id
                    )
                    if record.id == sourceRecords.last?.id, hasMoreRecords {
                        ProgressView()
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 12)
                            .task { await loadMoreRecords() }
                    }
                }
            }
        }
    }

    private func loadInitialContent() async {
        do {
            async let loadedDetail = CreationAPIClient.shared.fetchCreation(id: creation.id)
            async let firstPage = CreationAPIClient.shared.fetchSourceRecords(id: creation.id)
            detail = try await loadedDetail
            apply(try await firstPage)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func loadMoreRecords() async {
        guard let nextCursor, !isLoadingMoreRecords else { return }
        isLoadingMoreRecords = true
        defer { isLoadingMoreRecords = false }
        do {
            let page = try await CreationAPIClient.shared.fetchSourceRecords(id: creation.id, cursor: nextCursor)
            sourceRecords.append(contentsOf: page.records)
            apply(page)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func apply(_ page: CreationSourceRecordPage) {
        if sourceRecords.isEmpty {
            sourceRecords = page.records
        }
        hasMoreRecords = page.hasMore
        nextCursor = page.nextCursor
    }
}
