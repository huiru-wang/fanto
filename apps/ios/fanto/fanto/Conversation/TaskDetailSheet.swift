import SwiftUI

private enum TaskDetailLoadState {
    case loading
    case loaded(FantoTaskDetails)
    case failed(String)
}

struct TaskDetailSheet: View {
    let task: FantoTaskSummary
    let cache: TaskDetailCache
    @Environment(\.dismiss) private var dismiss
    @State private var loadState: TaskDetailLoadState = .loading

    var body: some View {
        NavigationStack {
            Group {
                switch loadState {
                case .loading:
                    ProgressView("正在读取任务详情")
                case let .failed(message):
                    ContentUnavailableView("暂时无法读取任务", systemImage: "exclamationmark.triangle", description: Text(message))
                case let .loaded(details):
                    ScrollView {
                        VStack(alignment: .leading, spacing: 24) {
                            statusHeader(details.task)
                            markdownSection("目标", details.task.goal.objective)
                            if let context = details.task.goal.context, !context.isEmpty {
                                markdownSection("说明", context)
                            }
                            markdownSection(
                                "要求",
                                listMarkdown(details.task.goal.constraints, fallback: "未设置额外要求。")
                            )
                            markdownSection(
                                "完成标准",
                                listMarkdown(details.task.goal.successCriteria, fallback: "完成任务目标并交付可用结果。")
                            )
                            if let plan = details.latestRun?.plan {
                                VStack(alignment: .leading, spacing: 10) {
                                    sectionTitle("计划")
                                    MarkdownContentView(markdown: plan.summary, leadingTitleToOmit: nil)
                                    ForEach(plan.steps) { step in
                                        HStack(alignment: .top, spacing: 10) {
                                            Image(systemName: "circle.fill")
                                                .font(.caption)
                                                .foregroundStyle(FantoTheme.accent)
                                                .frame(width: 24, height: 24)
                                            VStack(alignment: .leading, spacing: 2) {
                                                Text(step.title).font(.subheadline.weight(.semibold))
                                                if let description = step.description {
                                                    Text(description).font(.subheadline).foregroundStyle(.secondary)
                                                }
                                            }
                                        }
                                    }
                                }
                            } else {
                                markdownSection("计划", "任务开始执行后会在这里显示计划。")
                            }
                            if let delivery = details.latestDelivery, let result = delivery.result {
                                deliverySection(result)
                                markdownSection("结果摘要", result.summary)
                            } else if details.latestRun?.status == "completed" {
                                markdownSection("结果", "任务已完成，但没有可预览的交付成果。")
                            } else if details.latestRun != nil {
                                markdownSection("结果", "任务正在执行，完成后会在这里出现交付成果。")
                            } else {
                                markdownSection("结果", "任务等待开始执行。")
                            }
                        }
                        .padding()
                    }
                }
            }
            .navigationTitle(task.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("完成") { dismiss() }
                }
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        Task { await load(forceRefresh: true) }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .accessibilityLabel("刷新任务详情")
                }
            }
            .task(id: task.taskID) { await load(forceRefresh: false) }
        }
    }

    private func statusHeader(_ detail: FantoTaskDetail) -> some View {
        Label(detail.status == "active" ? "任务已下发" : detail.status, systemImage: detail.status == "active" ? "clock.badge.checkmark" : "checkmark.circle")
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(FantoTheme.accent)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(FantoTheme.softAccent, in: Capsule())
    }

    private func markdownSection(_ title: String, _ content: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionTitle(title)
            MarkdownContentView(markdown: content, leadingTitleToOmit: nil)
        }
    }

    private func deliverySection(_ result: FantoTaskRunResult) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionTitle("交付成果")
            ForEach(result.artifacts) { artifact in
                NavigationLink {
                    TaskArtifactPreviewView(artifact: artifact, cache: cache)
                } label: {
                    TaskArtifactRow(artifact: artifact)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func sectionTitle(_ title: String) -> some View {
        Text(title)
            .font(.headline)
    }

    private func listMarkdown(_ items: [String]?, fallback: String) -> String {
        guard let items, !items.isEmpty else { return fallback }
        return items.map { "- \($0)" }.joined(separator: "\n")
    }

    @MainActor
    private func load(forceRefresh: Bool) async {
        let userID = AgentAPIClient.shared.userID
        if !forceRefresh, let cached = cache.details(taskID: task.taskID, userID: userID) {
            loadState = .loaded(cached)
            return
        }
        loadState = .loading
        do {
            let details = try await AgentAPIClient.shared.fetchTaskDetails(taskID: task.taskID)
            cache.store(details, taskID: task.taskID, userID: userID)
            loadState = .loaded(details)
        } catch {
            loadState = .failed((error as? LocalizedError)?.errorDescription ?? "请稍后重试。")
        }
    }
}
