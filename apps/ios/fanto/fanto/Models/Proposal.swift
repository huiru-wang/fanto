import Foundation

struct Proposal: Identifiable, Hashable {
    let id: UUID
    let kind: CreationKind
    let title: String
    let insight: String
    let evidence: String
    let sourceCount: Int
    let suggestedNextStep: String

    init(id: UUID = UUID(), kind: CreationKind, title: String, insight: String, evidence: String, sourceCount: Int, suggestedNextStep: String) {
        self.id = id
        self.kind = kind
        self.title = title
        self.insight = insight
        self.evidence = evidence
        self.sourceCount = sourceCount
        self.suggestedNextStep = suggestedNextStep
    }
}
