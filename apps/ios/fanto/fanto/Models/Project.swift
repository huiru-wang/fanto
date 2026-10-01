import Foundation

enum ProjectStatus: String, Codable, Hashable {
    case proposed
    case active
    case archived
    case rejected

    var title: String {
        switch self {
        case .proposed: "等待确认"
        case .active: "跟踪中"
        case .archived: "已归档"
        case .rejected: "已拒绝"
        }
    }

    var symbol: String {
        switch self {
        case .proposed: "sparkles"
        case .active: "circle.dashed"
        case .archived: "archivebox"
        case .rejected: "xmark.circle"
        }
    }
}

struct Project: Identifiable, Hashable {
    let id: String
    let title: String
    let content: String
    let status: ProjectStatus
    let version: Int
    let createdAt: Date
    let updatedAt: Date
}
