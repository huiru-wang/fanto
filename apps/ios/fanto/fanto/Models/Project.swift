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
struct ProposalContent: Codable, Hashable {
    let reason: String
    let idea: String
    let plan: [String]
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
}
