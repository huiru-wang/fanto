import Foundation

struct CreationKind: Hashable, Codable, Identifiable {
    let id: String
    let name: String
    let title: String
    var symbol: String {
        switch name {
        case "thread": "point.3.connected.trianglepath.dotted"
        case "research": "text.magnifyingglass"
        case "project": "square.stack.3d.up"
        case "collection": "books.vertical"
        default: "point.3.connected.trianglepath.dotted"
        }
    }

    static let thread = CreationKind(id: "thread", name: "thread", title: "持续线索")
    static let research = CreationKind(id: "research", name: "research", title: "研究")
    static let possibility = CreationKind(id: "possibility", name: "possibility", title: "可能性")
    static let project = CreationKind(id: "project", name: "project", title: "正在推进")
}

enum CreationStatus: String, CaseIterable, Codable, Identifiable {
    case active
    case resting
    case archived

    var id: String { rawValue }

    var title: String {
        switch self {
        case .active: "跟踪中"
        case .resting: "暂缓"
        case .archived: "已归档"
        }
    }

    var symbol: String {
        switch self {
        case .active: "circle.dashed"
        case .resting: "pause.circle"
        case .archived: "archivebox"
        }
    }
}

struct Creation: Identifiable, Hashable {
    let id: String
    let kind: CreationKind
    let title: String
    let summary: String
    let updatedAt: Date
    let sourceCount: Int?
    let nextStep: String?
    let content: String?
    let status: CreationStatus

    init(
        id: String = UUID().uuidString,
        kind: CreationKind,
        title: String,
        summary: String,
        updatedAt: Date,
        sourceCount: Int? = nil,
        nextStep: String? = nil,
        status: CreationStatus = .active,
        content: String? = nil
    ) {
        self.id = id
        self.kind = kind
        self.title = title
        self.summary = summary
        self.updatedAt = updatedAt
        self.sourceCount = sourceCount
        self.nextStep = nextStep
        self.status = status
        self.content = content
    }
}
