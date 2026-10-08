import Foundation

enum ProjectStatus: String, Codable, Hashable {
    case active, archived
    var title: String { self == .active ? "创作成果" : "已归档" }
    var symbol: String { self == .active ? "book.closed" : "archivebox" }
}
struct Project: Identifiable, Hashable {
    let id: String
    let title: String
    let summary: String
    var sessionID: String? = nil
    var coverMediaID: String? = nil
    let content: String
    let status: ProjectStatus
    let version: Int
    let createdAt: Date
    let updatedAt: Date
}
struct ProjectDetail {
    let project: Project
    let recordCount: Int
    let referenceRecords: [Record]
}
enum ProposalType: String, Codable, Hashable { case create, extend }
enum ProposalStatus: String, Codable, Hashable { case pending, accepted, rejected }

struct ProposalGoal: Decodable, Hashable {
    let objective: String
    let context: String?
    let constraints: [String]?
    let successCriteria: [String]?
}

struct ProposalContent: Decodable, Hashable {
    let reason: String
    let idea: String
    let plan: [String]
    let tags: [String]
    let goal: ProposalGoal?

    private enum CodingKeys: String, CodingKey {
        case reason, idea, plan, tags, goal
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        reason = try container.decode(String.self, forKey: .reason)
        idea = try container.decode(String.self, forKey: .idea)
        plan = try container.decode([String].self, forKey: .plan)
        tags = try container.decodeIfPresent([String].self, forKey: .tags) ?? []
        goal = try container.decodeIfPresent(ProposalGoal.self, forKey: .goal)
    }

    var preserveText: String? { facet(named: "保留") }
    var transformText: String? { facet(named: "转化") }

    private func facet(named name: String) -> String? {
        guard let constraints = goal?.constraints else { return nil }
        let prefixes = ["\(name)：", "\(name):", "\(name)｜", "\(name)|"]
        for constraint in constraints {
            for prefix in prefixes where constraint.hasPrefix(prefix) {
                let value = String(constraint.dropFirst(prefix.count)).trimmingCharacters(in: .whitespacesAndNewlines)
                if !value.isEmpty { return value }
            }
        }
        return nil
    }
}

struct Proposal: Identifiable, Hashable {
    let id: String
    let type: ProposalType
    let targetProjectID: String?
    let title: String
    let content: ProposalContent
    let status: ProposalStatus
    let resultProjectID: String?
    let createdAt: Date
    let referenceRecordCount: Int?
}
