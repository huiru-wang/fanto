import Foundation

nonisolated struct FantoTaskGoal: Decodable, Equatable {
    let objective: String
    let context: String?
    let constraints: [String]?
    let successCriteria: [String]?
}

nonisolated struct FantoTaskDetail: Decodable, Equatable {
    let taskID: String
    let title: String
    let status: String
    let goal: FantoTaskGoal

    enum CodingKeys: String, CodingKey {
        case taskID = "taskId"
        case title, status, goal
    }
}

nonisolated struct FantoTaskRunPlanStep: Decodable, Identifiable, Equatable {
    let id: String
    let title: String
    let description: String?
}

nonisolated struct FantoTaskRunPlan: Decodable, Equatable {
    let summary: String
    let steps: [FantoTaskRunPlanStep]
}

nonisolated struct FantoTaskRunResult: Decodable, Equatable {
    let summary: String
    let artifacts: [FantoTaskArtifact]
}

nonisolated enum FantoTaskArtifactRole: String, Decodable, Equatable {
    case primary
    case supplementary
}

nonisolated enum FantoTaskArtifactFormat: String, Decodable, Equatable {
    case html
    case markdown
    case text
}

nonisolated struct FantoTaskArtifact: Decodable, Identifiable, Equatable {
    let filename: String
    let role: FantoTaskArtifactRole
    let mediaID: String
    let mimeType: String

    var id: String { mediaID }

    var format: FantoTaskArtifactFormat? {
        switch mimeType {
        case "text/html": .html
        case "text/markdown": .markdown
        case "text/plain": .text
        default: nil
        }
    }

    enum CodingKeys: String, CodingKey {
        case filename, role, mimeType
        case mediaID = "mediaId"
    }
}

nonisolated struct FantoTaskRun: Decodable, Identifiable, Equatable {
    let runID: String
    let status: String
    let plan: FantoTaskRunPlan?
    let result: FantoTaskRunResult?

    var id: String { runID }

    enum CodingKeys: String, CodingKey {
        case runID = "runId"
        case status, plan, result
    }
}

struct FantoTaskDetails: Equatable {
    let task: FantoTaskDetail
    let runs: [FantoTaskRun]

    var latestRun: FantoTaskRun? { runs.first }

    var latestDelivery: FantoTaskRun? {
        runs.first { run in
            guard run.status == "completed", let result = run.result else { return false }
            return !result.artifacts.isEmpty
        }
    }
}

nonisolated struct FantoTaskArtifactPreview: Decodable, Equatable {
    let mediaID: String
    let filename: String
    let mimeType: String
    let format: FantoTaskArtifactFormat
    let content: String

    enum CodingKeys: String, CodingKey {
        case filename, mimeType, format, content
        case mediaID = "mediaId"
    }
}
