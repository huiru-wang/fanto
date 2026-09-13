import SwiftUI

struct CreationDetailView: View {
    let creation: Creation
    @State private var detail: Creation?
    @State private var sourceRecords: [CreationSourceRecord] = []
    @State private var nextCursor: String?
    @State private var hasMoreRecords = false
    @State private var errorMessage: String?

    private var displayedCreation: Creation { detail ?? creation }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Label(displayedCreation.kind.title, systemImage: displayedCreation.kind.symbol)
                    .font(.headline)
                    .foregroundStyle(FantoTheme.accent)
                Text(displayedCreation.title)
                    .font(.largeTitle)
                    .bold()
                Text(displayedCreation.summary)
                    .font(.title3)

                if let content = displayedCreation.content {
                    Divider()
                    Text("内容")
                        .font(.headline)
                    Text(content)
                        .textSelection(.enabled)
                }

                Divider()
                LabeledContent("最近更新") {
                    Text(displayedCreation.updatedAt, format: .dateTime.year().month().day())
                }
                LabeledContent("状态") {
                    Label(displayedCreation.status.title, systemImage: displayedCreation.status.symbol)
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
            ForEach(sourceRecords) { record in
                VStack(alignment: .leading, spacing: 4) {
                    Text(record.text)
                    Text(record.createdAt, format: .dateTime.year().month().day())
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 4)
            }
            if hasMoreRecords {
                Button("加载更多来源记录") {
                    Task { await loadMoreRecords() }
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
        guard let nextCursor else { return }
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
