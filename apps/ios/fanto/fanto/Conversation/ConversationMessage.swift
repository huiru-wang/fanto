import Foundation

enum ConversationRole: String, Codable {
    case user
    case assistant
}

enum ConversationMessageState: Equatable {
    case complete
    case waiting
    case processing
    case streaming
    case stopped
    case failed(String)
}

enum ConversationToolActivityState: Equatable {
    case inProgress
    case succeeded
    case failed
}

struct ConversationToolActivity: Identifiable, Equatable {
    let id: String
    var text: String
    var animation: String?
    var state: ConversationToolActivityState
}

nonisolated struct FantoUserInputOption: Identifiable, Decodable, Equatable {
    let value: String
    let label: String

    var id: String { value }
}

nonisolated enum FantoUserInputQuestionKind: String, Decodable, Equatable {
    case singleSelect = "single_select"
    case multiSelect = "multi_select"
    case text
}

nonisolated struct FantoUserInputQuestion: Identifiable, Decodable, Equatable {
    let id: String
    let type: FantoUserInputQuestionKind
    let label: String
    let options: [FantoUserInputOption]?
    let allowOther: Bool?
    let required: Bool?
    let placeholder: String?
    let multiline: Bool?

    var isRequired: Bool { required ?? true }
}

nonisolated struct FantoUserInputRequest: Identifiable, Decodable, Equatable {
    let interactionID: String
    let title: String
    let description: String?
    let questions: [FantoUserInputQuestion]
    var isResolved: Bool

    var id: String { interactionID }

    enum CodingKeys: String, CodingKey {
        case interactionID = "interactionId"
        case title, description, questions, isResolved = "resolved"
    }

    init(interactionID: String, title: String, description: String?, questions: [FantoUserInputQuestion], isResolved: Bool = false) {
        self.interactionID = interactionID
        self.title = title
        self.description = description
        self.questions = questions
        self.isResolved = isResolved
    }
}

struct FantoUserInputResponse: Equatable {
    let interactionID: String
    let content: String
}

nonisolated struct FantoTaskSummary: Identifiable, Decodable, Equatable {
    let taskID: String
    let title: String
    let status: String
    let nextRunAt: String

    var id: String { taskID }

    enum CodingKeys: String, CodingKey {
        case taskID = "taskId"
        case title, status, nextRunAt
    }
}

struct ConversationMessage: Identifiable, Equatable {
    let id: String
    let role: ConversationRole
    var text: String
    var media: [PresentedMedia] = []
    var activities: [ConversationToolActivity] = []
    var tasks: [FantoTaskSummary] = []
    var userInputRequest: FantoUserInputRequest?
    var userInputResponse: FantoUserInputResponse?
    var state: ConversationMessageState

    static func user(id: String, text: String) -> Self {
        Self(id: id, role: .user, text: text, state: .complete)
    }

    static func assistantPlaceholder(id: String) -> Self {
        Self(id: id, role: .assistant, text: "", state: .waiting)
    }

    static func userInputResponse(id: String, interactionID: String, content: String) -> Self {
        Self(
            id: id,
            role: .user,
            text: content,
            userInputResponse: FantoUserInputResponse(interactionID: interactionID, content: content),
            state: .complete
        )
    }
}
