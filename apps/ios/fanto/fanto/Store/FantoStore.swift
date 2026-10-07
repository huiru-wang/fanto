import Foundation
import Observation

enum ProjectLoadState: Equatable {
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
    var projects: [Project]
    var proposals: [Proposal]
    var recordLoadState: RecordLoadState = .idle
    private(set) var recordNextCursor: String?
    private(set) var isLoadingMoreRecords = false
    private(set) var recordLoadMoreError: String?
    var projectLoadState: ProjectLoadState = .idle
    var proposalLoadState: ProjectLoadState = .idle
    var projectActionError: String?

    private let recordSnapshotStore: RecordSnapshotStore
    private var snapshotUserID: String?

    init(
        records: [Record] = [],
        projects: [Project] = [],
        proposals: [Proposal] = [],
        recordSnapshotStore: RecordSnapshotStore = .shared
    ) {
        self.records = records
        self.projects = projects
        self.proposals = proposals
        self.recordSnapshotStore = recordSnapshotStore
    }

    func loadProjects() async {
        projectLoadState = .loading
        do {
            var cursor: String?
            var loaded: [Project] = []
            repeat {
                let page = try await FantoAPIClient.shared.fetchProjects(status: .active, cursor: cursor)
                loaded += page.projects
                cursor = page.hasMore ? page.nextCursor : nil
            } while cursor != nil
            var seen = Set<String>()
            projects = loaded.filter { seen.insert($0.id).inserted }
            projectLoadState = .loaded
        } catch {
            projectLoadState = .failed(error.localizedDescription)
        }
        await loadProposals()
    }

    func refreshCreativeSuggestions() async {
        await loadProposals(silent: true)
    }

    func loadProposals(silent: Bool = false) async {
        if !silent { proposalLoadState = .loading }
        do {
            var cursor: String?
            var loaded: [Proposal] = []
            repeat {
                let page = try await FantoAPIClient.shared.fetchProposals(cursor: cursor)
                loaded += page.proposals
                cursor = page.hasMore ? page.nextCursor : nil
            } while cursor != nil
            var seen = Set<String>()
            proposals = loaded.filter { seen.insert($0.id).inserted }
            proposalLoadState = .loaded
        } catch {
            if !silent { proposals = [] }
            proposalLoadState = .failed(error.localizedDescription)
        }
    }

    func accept(_ proposal: Proposal) async -> Bool {
        do {
            _ = try await FantoAPIClient.shared.acceptProposal(id: proposal.id)
            proposals.removeAll { $0.id == proposal.id }
            await loadProjects()
            return true
        } catch {
            projectActionError = error.localizedDescription
            return false
        }
    }

    func decline(_ proposal: Proposal) async -> Bool {
        do {
            _ = try await FantoAPIClient.shared.rejectProposal(id: proposal.id)
            proposals.removeAll { $0.id == proposal.id }
            return true
        } catch {
            projectActionError = error.localizedDescription
            return false
        }
    }

    func loadRecords() async {
        guard recordLoadState != .loading, !isLoadingMoreRecords else { return }
        if records.isEmpty { recordLoadState = .loading }
        recordLoadMoreError = nil
        recordNextCursor = nil

        do {
            let page = try await FantoAPIClient.shared.fetchRecords()
            records = orderedUniqueRecords(page.records)
            recordNextCursor = page.nextCursor
            recordLoadState = .loaded(hasMore: page.hasMore)
            await saveRecordSnapshot()
        } catch {
            recordLoadState = records.isEmpty ? .failed(error.localizedDescription) : .loaded(hasMore: false)
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
            let page = try await FantoAPIClient.shared.fetchRecords(cursor: recordNextCursor)
            records = orderedUniqueRecords(records + page.records)
            self.recordNextCursor = page.nextCursor
            recordLoadState = .loaded(hasMore: page.hasMore)
            await saveRecordSnapshot()
        } catch {
            recordLoadMoreError = error.localizedDescription
        }
    }

    func addRecord(text: String, location: RecordLocation?, eventAt: Date) {
        records.append(Record(text: text, eventAt: eventAt, location: location))
        records = orderedUniqueRecords(records)
        saveRecordSnapshotInBackground()
    }

    func restoreRecordSnapshot(for userID: String) async {
        guard snapshotUserID != userID else { return }
        snapshotUserID = userID
        let cachedRecords = await recordSnapshotStore.load(for: userID)
        guard !cachedRecords.isEmpty else { return }
        records = orderedUniqueRecords(cachedRecords)
        if recordLoadState == .idle { recordLoadState = .loaded(hasMore: false) }
    }

    func resetUserData() {
        if let snapshotUserID {
            Task { [recordSnapshotStore] in await recordSnapshotStore.clear(for: snapshotUserID) }
        }
        records = []
        projects = []
        proposals = []
        recordLoadState = .idle
        recordNextCursor = nil
        isLoadingMoreRecords = false
        recordLoadMoreError = nil
        projectLoadState = .idle
        proposalLoadState = .idle
        projectActionError = nil
        snapshotUserID = nil
    }

    private func orderedUniqueRecords(_ candidates: [Record]) -> [Record] {
        var seen = Set<String>()
        return candidates
            .sorted { $0.eventAt == $1.eventAt ? $0.id > $1.id : $0.eventAt > $1.eventAt }
            .filter { seen.insert($0.id).inserted }
    }

    private func saveRecordSnapshot() async {
        guard let snapshotUserID else { return }
        await recordSnapshotStore.save(records, for: snapshotUserID)
    }

    private func saveRecordSnapshotInBackground() {
        guard let snapshotUserID else { return }
        let records = records
        let snapshotStore = recordSnapshotStore
        Task { await snapshotStore.save(records, for: snapshotUserID) }
    }
}

extension FantoStore {
    static let preview: FantoStore = {
        let project = Project(
            id: UUID().uuidString,
            title: "关于有边界的投入",
            summary: "记录生活中的选择与投入。",
            content: "不是减少投入，而是让投入能被自己选择。",
            status: .active,
            version: 1,
            createdAt: .now,
            updatedAt: .now
        )
        let store = FantoStore(projects: [project])
        store.projectLoadState = .loaded
        store.proposalLoadState = .loaded
        store.recordLoadState = .loaded(hasMore: false)
        return store
    }()
}
