import SwiftUI

private enum TaskDetailLoadState {
    case loading
    case loaded(FantoTaskDetails)
    case failed(String)
}

struct TaskDetailSheet: View {
    let task: FantoTaskSummary
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
                            if let result = details.latestRun?.result {
                                markdownSection("结果", result.summary)
                            } else {
                                markdownSection("结果", "任务尚未生成结果。")
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
            }
            .task(id: task.taskID) { await load() }
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

    private func sectionTitle(_ title: String) -> some View {
        Text(title)
            .font(.headline)
    }

    private func listMarkdown(_ items: [String]?, fallback: String) -> String {
        guard let items, !items.isEmpty else { return fallback }
        return items.map { "- \($0)" }.joined(separator: "\n")
    }

    @MainActor
    private func load() async {
        loadState = .loading
        do {
            loadState = .loaded(try await AgentAPIClient.shared.fetchTaskDetails(taskID: task.taskID))
        } catch {
            loadState = .failed((error as? LocalizedError)?.errorDescription ?? "请稍后重试。")
        }
    }
}
