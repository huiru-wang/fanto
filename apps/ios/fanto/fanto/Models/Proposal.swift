import Foundation

struct ProposalSourceRecord: Identifiable, Hashable {
    let id: String
    let text: String
    let createdAt: Date
}

struct Proposal: Identifiable, Hashable {
    let id: String
    let kind: CreationKind
    let title: String
    let insight: String
    let evidence: String
    let sourceCount: Int
    let suggestedNextStep: String
    let createdAt: Date?
    let sourceRecords: [ProposalSourceRecord]

    init(id: String = UUID().uuidString, kind: CreationKind, title: String, insight: String, evidence: String, sourceCount: Int, suggestedNextStep: String, createdAt: Date? = nil, sourceRecords: [ProposalSourceRecord] = []) {
        self.id = id
        self.kind = kind
        self.title = title
        self.insight = insight
        self.evidence = evidence
        self.sourceCount = sourceCount
        self.suggestedNextStep = suggestedNextStep
        self.createdAt = createdAt
        self.sourceRecords = sourceRecords
    }
}
