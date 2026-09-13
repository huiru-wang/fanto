import Foundation
import Observation

enum CreationLoadState: Equatable {
    case idle
    case loading
    case loaded
    case failed(String)
}

@Observable
final class FantoStore {
    var records: [Record]
    var proposals: [Proposal]
    var creations: [Creation]
    var creationKinds: [CreationKind]
    var creationLoadState: CreationLoadState = .idle

    init(
        records: [Record] = [],
        proposals: [Proposal] = [],
        creations: [Creation] = [],
        creationKinds: [CreationKind] = []
    ) {
        self.records = records
        self.proposals = proposals
        self.creations = creations
        self.creationKinds = creationKinds
    }

    func loadCreations() async {
        creationLoadState = .loading

        do {
            let overview = try await CreationAPIClient.shared.fetchOverview()
            creations = overview.tracking
            creationKinds = overview.kinds
            creationLoadState = .loaded
        } catch {
            creationLoadState = .failed(error.localizedDescription)
        }
    }

    // Proposal 写接口尚未由本地服务提供；以下仅保留给 SwiftUI Preview 使用。
    func accept(_ proposal: Proposal) {
        creations.insert(
            Creation(
                kind: proposal.kind,
                title: proposal.title,
                summary: proposal.insight,
                updatedAt: .now,
                sourceCount: proposal.sourceCount,
                nextStep: proposal.suggestedNextStep
            ),
            at: 0
        )
        proposals.removeAll { $0.id == proposal.id }
    }

    func decline(_ proposal: Proposal) {
        proposals.removeAll { $0.id == proposal.id }
    }

    func addRecord(text: String, location: String?) {
        records.insert(Record(text: text, location: location), at: 0)
    }
}

extension FantoStore {
    static let preview: FantoStore = {
        let store = FantoStore(
            creations: [
                Creation(kind: .thread, title: "关于有边界的投入", summary: "不是减少投入，而是让投入能被自己选择。", updatedAt: .now, sourceCount: 6, nextStep: "查看最近的变化")
            ],
            creationKinds: [.thread]
        )
        store.creationLoadState = .loaded
        return store
    }()
}
