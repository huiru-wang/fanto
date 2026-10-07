import SwiftUI

struct ProjectDetailView: View {
    let project: Project
    @Environment(FantoStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @State private var creation: ProjectCreation?
    @State private var detail: ProjectDetail?
    @State private var errorMessage: String?
    @State private var showsArchiveConfirmation = false
    @State private var isArchiving = false
    private var displayedProject: Project { detail?.project ?? project }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Text(displayedProject.title).font(.title).bold()
                    .fixedSize(horizontal: false, vertical: true)
                Text("\(displayedProject.status.title) · \(FantoDateText.timestamp(displayedProject.updatedAt))")
                    .font(.caption).foregroundStyle(.secondary)
                if let creation, creation.status != "completed" {
                    HStack {
                        if creation.isPending { ProgressView() }
                        Text(creation.label).font(.subheadline).foregroundStyle(.secondary)
                    }.accessibilityElement(children: .combine)
                }
                if !displayedProject.content.isEmpty {
                    MarkdownContentView(markdown: displayedProject.content, leadingTitleToOmit: displayedProject.title, allowsHTMLPreview: true)
                } else {
                    Text(displayedProject.summary).foregroundStyle(.secondary)
                    Text("成果正文暂未发布").font(.caption).foregroundStyle(.secondary)
                }
                if let detail, !detail.referenceRecords.isEmpty {
                    Divider()
                    Text("参考记录 · \(detail.recordCount)").font(.headline)
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(detail.referenceRecords) { record in
                            ProjectRecordTimelineRow(record: record, showsLineAfter: record.id != detail.referenceRecords.last?.id)
                        }
                    }
                }
                if let errorMessage {
                    ContentUnavailableView("部分内容未能加载", systemImage: "exclamationmark.triangle", description: Text(errorMessage))
                    Button("重新加载") { Task { await load() } }
                }
            }.padding()
        }
        .navigationTitle("创作成果")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if displayedProject.status == .active {
                Button("归档", systemImage: "archivebox") { showsArchiveConfirmation = true }
                    .disabled(isArchiving)
            }
        }
        .confirmationDialog("归档后仍可保留成果，但不能继续修改或扩展。", isPresented: $showsArchiveConfirmation, titleVisibility: .visible) {
            Button("归档项目") { Task { await archive() } }
            Button("取消", role: .cancel) {}
        }
        .refreshable {
            await load()
            creation = try? await FantoAPIClient.shared.fetchCreation(projectID: project.id)
        }
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            await load()
            for attempt in 0..<600 {
                do {
                    creation = try await FantoAPIClient.shared.fetchCreation(projectID: project.id)
                    if creation?.status == "completed" {
                        await load()
                        await store.loadProjects()
                        return
                    }
                    if let creation, !creation.isPending { return }
                    if creation == nil && attempt >= 15 { return }
                    try await Task.sleep(for: .seconds(2))
                } catch { return }
            }
        }
    }
    private func load() async {
        do {
            detail = try await FantoAPIClient.shared.fetchProject(id: project.id)
            errorMessage = nil
        } catch { errorMessage = error.localizedDescription }
    }
    private func archive() async {
        guard !isArchiving else { return }
        isArchiving = true
        defer { isArchiving = false }
        do {
            try await FantoAPIClient.shared.archiveProject(id: project.id, expectedVersion: displayedProject.version)
            await store.loadProjects()
            dismiss()
        } catch { errorMessage = error.localizedDescription }
    }
}
