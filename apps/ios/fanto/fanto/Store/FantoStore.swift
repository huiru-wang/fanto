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

enum ProposalLoadState: Equatable {
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
    var recordLoadState: RecordLoadState = .idle
    private(set) var recordNextCursor: String?
    private(set) var isLoadingMoreRecords = false
    private(set) var recordLoadMoreError: String?
    var creationLoadState: CreationLoadState = .idle
    var proposalLoadState: ProposalLoadState = .idle
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
        guard recordLoadState != .loading, !isLoadingMoreRecords else { return }
        recordLoadState = .loading
        recordLoadMoreError = nil
        recordNextCursor = nil

        do {
            let page = try await CreationAPIClient.shared.fetchRecords()
            records = orderedUniqueRecords(page.records)
            recordNextCursor = page.nextCursor
            recordLoadState = .loaded(hasMore: page.hasMore)
        } catch {
            recordLoadState = .failed(error.localizedDescription)
        }
    }

    func loadMoreRecords() async {
        guard case let .loaded(hasMore) = recordLoadState,
              hasMore,
              let recordNextCursor,
              !isLoadingMoreRecords
        else { return }

        isLoadingMoreRecords = true
        recordLoadMoreError = nil
        defer { isLoadingMoreRecords = false }

        do {
            let page = try await CreationAPIClient.shared.fetchRecords(cursor: recordNextCursor)
            records = orderedUniqueRecords(records + page.records)
            self.recordNextCursor = page.nextCursor
            recordLoadState = .loaded(hasMore: page.hasMore)
        } catch {
            recordLoadMoreError = error.localizedDescription
        }
    }

    func loadProposals() async {
        proposalLoadState = .loading

        do {
            proposals = try await CreationAPIClient.shared.fetchProposals()
            proposalLoadState = .loaded
        } catch {
            proposals = []
            proposalLoadState = .failed(error.localizedDescription)
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

    func addRecord(text: String, location: String?, eventAt: Date) {
        records.append(Record(text: text, eventAt: eventAt, location: location))
        records = orderedUniqueRecords(records)
    }

    func resetUserData() {
        records = []
        proposals = []
        creations = []
        creationKinds = []
        recordLoadState = .idle
        recordNextCursor = nil
        isLoadingMoreRecords = false
        recordLoadMoreError = nil
        creationLoadState = .idle
        proposalLoadState = .idle
        proposalActionError = nil
    }

    private func orderedUniqueRecords(_ candidates: [Record]) -> [Record] {
        var seen = Set<String>()
        return candidates
            .sorted {
                $0.eventAt == $1.eventAt ? $0.id > $1.id : $0.eventAt > $1.eventAt
            }
            .filter { seen.insert($0.id).inserted }
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
