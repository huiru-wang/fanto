import Foundation
import Observation

enum CreationLoadState: Equatable {
    case idle
    case loading
    case loaded
    case failed(String)
}

enum RecordLoadState: Equatable {
    case idle
    case loading
    case loaded(hasMore: Bool)
    case failed(String)
}

@Observable
final class FantoStore {
    var records: [Record]
    var proposals: [Proposal]
    var creations: [Creation]
    var creationKinds: [CreationKind]
    var recordLoadState: RecordLoadState = .idle
    var creationLoadState: CreationLoadState = .idle
    var proposalActionError: String?

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

        await loadProposals()
    }

    func loadRecords() async {
        recordLoadState = .loading

        do {
            let page = try await CreationAPIClient.shared.fetchRecords()
            records = page.records
            recordLoadState = .loaded(hasMore: page.hasMore)
        } catch {
            recordLoadState = .failed(error.localizedDescription)
        }
    }

    func loadProposals() async {
        do {
            proposals = try await CreationAPIClient.shared.fetchProposals()
        } catch {
            proposals = []
        }
    }

    func accept(_ proposal: Proposal) async -> Bool {
        do {
            try await CreationAPIClient.shared.confirmProposal(id: proposal.id)
            proposals.removeAll { $0.id == proposal.id }
            await loadCreations()
            return true
        } catch {
            proposalActionError = error.localizedDescription
            return false
        }
    }

    func decline(_ proposal: Proposal) async -> Bool {
        do {
            try await CreationAPIClient.shared.rejectProposal(id: proposal.id)
            proposals.removeAll { $0.id == proposal.id }
            return true
        } catch {
            proposalActionError = error.localizedDescription
            return false
        }
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
        store.recordLoadState = .loaded(hasMore: false)
        return store
    }()
}
