import Foundation

enum ProjectStatus: String, Codable, Hashable {
    case queued, running, completed, failed, archived

    var title: String {
        switch self {
        case .queued: "等待创作"
        case .running: "正在创作"
        case .completed: "创作完成"
        case .failed: "本次创作未完成"
        case .archived: "已归档"
        }
    }

    var symbol: String {
        switch self {
        case .queued: "clock"
        case .running: "sparkles"
        case .completed: "checkmark.circle"
        case .failed: "exclamationmark.circle"
        case .archived: "archivebox"
        }
    }

    var canContinue: Bool { self == .completed || self == .failed }
    var canArchive: Bool { canContinue }
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

struct ProposalIdea: Decodable, Hashable, Identifiable {
    let id: String
    let title: String
    let idea: String
    let tags: [String]
}

struct ProposalContent: Decodable, Hashable {
    let opening: String?
    let ideas: [ProposalIdea]
    let selectedIdeaId: String?
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
