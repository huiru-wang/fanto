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
    let latestRun: FantoTaskRun?
}
