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

struct ConversationMessage: Identifiable, Equatable {
    let id: String
    let role: ConversationRole
    var text: String
    var media: [PresentedMedia] = []
    var state: ConversationMessageState

    static func user(id: String, text: String) -> Self {
        Self(id: id, role: .user, text: text, state: .complete)
    }

    static func assistantPlaceholder(id: String) -> Self {
        Self(id: id, role: .assistant, text: "", state: .waiting)
    }
}
