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
    var recordActionError: String?
    private(set) var deletingRecordIDs = Set<String>()
    private var deletedRecordIDs = Set<String>()
    private var dataGeneration = UUID()
    private var projectRequestID: UUID?
    private var proposalRequestID: UUID?

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
        let requestID = UUID()
        projectRequestID = requestID
        let previousState = projectLoadState
        projectLoadState = .loading
        do {
            var cursor: String?
            var loaded: [Project] = []
            repeat {
                try Task.checkCancellation()
                let page = try await FantoAPIClient.shared.fetchProjects(cursor: cursor)
                loaded += page.projects
                cursor = page.hasMore ? page.nextCursor : nil
            } while cursor != nil
            try Task.checkCancellation()
            guard projectRequestID == requestID else { return }
            var seen = Set<String>()
            projects = loaded.filter { seen.insert($0.id).inserted }
            projectLoadState = .loaded
        } catch {
            guard projectRequestID == requestID else { return }
            if isCancellation(error) {
                projectLoadState = previousState == .loading ? .idle : previousState
                return
            }
            projectLoadState = .failed(error.localizedDescription)
        }
        guard !Task.isCancelled else { return }
        await loadProposals()
    }

    func refreshActiveProjectStates() async {
        for project in projects where project.status == .queued || project.status == .running {
            guard !Task.isCancelled else { return }
            guard let current = try? await FantoAPIClient.shared.fetchProject(id: project.id).project else { continue }
            if let index = projects.firstIndex(where: { $0.id == project.id }) {
                if current.status == .archived { projects.remove(at: index) }
                else { projects[index] = current }
            }
        }
    }

    func refreshCreativeSuggestions() async {
        await loadProposals(silent: true)
    }

    func loadProposals(silent: Bool = false) async {
        let requestID = UUID()
        proposalRequestID = requestID
        let previousState = proposalLoadState
        if !silent || previousState != .loaded { proposalLoadState = .loading }
        do {
            var cursor: String?
            var loaded: [Proposal] = []
            repeat {
                try Task.checkCancellation()
                let page = try await FantoAPIClient.shared.fetchProposals(cursor: cursor)
                loaded += page.proposals
                cursor = page.hasMore ? page.nextCursor : nil
            } while cursor != nil
            try Task.checkCancellation()
            guard proposalRequestID == requestID else { return }
            var seen = Set<String>()
            proposals = loaded.filter { seen.insert($0.id).inserted }
            proposalLoadState = .loaded
        } catch {
            guard proposalRequestID == requestID else { return }
            if isCancellation(error) || (silent && previousState == .loaded) {
                proposalLoadState = previousState == .loading ? .idle : previousState
                return
            }
            proposalLoadState = .failed(error.localizedDescription)
        }
    }

    private func isCancellation(_ error: Error) -> Bool {
        Task.isCancelled || error is CancellationError || (error as? URLError)?.code == .cancelled
    }

    func deleteRecord(_ record: Record) async {
        guard !deletingRecordIDs.contains(record.id) else { return }
        let generation = dataGeneration
        deletingRecordIDs.insert(record.id)
        recordActionError = nil
        defer { if generation == dataGeneration { deletingRecordIDs.remove(record.id) } }
        do {
            let version: Int
            if let currentVersion = record.version {
                version = currentVersion
            } else {
                let current = try await FantoAPIClient.shared.fetchRecord(id: record.id)
                guard current.text == record.text, current.eventAt == record.eventAt,
                      current.location == record.location, current.media == record.media else {
                    recordActionError = "记录已发生变化，请刷新后再确认删除。"
                    await loadRecords()
                    return
                }
                guard let currentVersion = current.version else { throw FantoAPIError.invalidResponse }
                version = currentVersion
            }
            try Task.checkCancellation()
            guard generation == dataGeneration else { return }
            try await FantoAPIClient.shared.deleteRecord(id: record.id, expectedVersion: version)
        } catch {
            guard generation == dataGeneration else { return }
            let errorCode = (error as? FantoAPIError)?.code
            if errorCode == "NOT_FOUND" {
                // Already deleted on another device: converge the local snapshot.
            } else {
                if !isCancellation(error) {
                    if errorCode == "VERSION_CONFLICT" {
                        recordActionError = "记录已发生变化，请刷新后再确认删除。"
                        await loadRecords()
                    } else {
                        recordActionError = error.localizedDescription
                    }
                }
                return
            }
        }
        guard generation == dataGeneration else { return }
        deletedRecordIDs.insert(record.id)
        records.removeAll { $0.id == record.id }
        await saveRecordSnapshot()
        guard generation == dataGeneration else { return }
        await loadProjects()
    }

    func accept(_ proposal: Proposal, selectedIdeaId: String) async -> Project? {
        do {
            let projectId = try await FantoAPIClient.shared.acceptProposal(id: proposal.id, selectedIdeaId: selectedIdeaId)
            proposals.removeAll { $0.id == proposal.id }
            // Accepted Project may not yet be present in the paged list.
            let accepted = try await FantoAPIClient.shared.fetchProject(id: projectId)
            // Keep the existing navigation tree stable while opening the Project.
            // A full list reload would temporarily switch ProjectsView into loading.
            projects.removeAll { $0.id == projectId }
            projects.insert(accepted.project, at: 0)
            return accepted.project
        } catch {
            projectActionError = error.localizedDescription
            return nil
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
        let generation = dataGeneration
        let previousState = recordLoadState
        if records.isEmpty { recordLoadState = .loading }
        recordLoadMoreError = nil
        recordNextCursor = nil

        do {
            let page = try await FantoAPIClient.shared.fetchRecords()
            try Task.checkCancellation()
            guard generation == dataGeneration else { return }
            records = orderedUniqueRecords(page.records)
            recordNextCursor = page.nextCursor
            recordLoadState = .loaded(hasMore: page.hasMore)
            await saveRecordSnapshot()
        } catch {
            guard generation == dataGeneration else { return }
            if isCancellation(error) { recordLoadState = previousState; return }
            recordLoadState = records.isEmpty ? .failed(error.localizedDescription) : .loaded(hasMore: false)
        }
    }

    func loadMoreRecords() async {
        guard case let .loaded(hasMore) = recordLoadState,
              hasMore,
              let recordNextCursor,
              !isLoadingMoreRecords
        else { return }

        let generation = dataGeneration
        isLoadingMoreRecords = true
        recordLoadMoreError = nil
        defer { if generation == dataGeneration { isLoadingMoreRecords = false } }

        do {
            let page = try await FantoAPIClient.shared.fetchRecords(cursor: recordNextCursor)
            try Task.checkCancellation()
            guard generation == dataGeneration else { return }
            records = orderedUniqueRecords(records + page.records)
            self.recordNextCursor = page.nextCursor
            recordLoadState = .loaded(hasMore: page.hasMore)
            await saveRecordSnapshot()
        } catch {
            guard generation == dataGeneration, !isCancellation(error) else { return }
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
        guard snapshotUserID == userID, !cachedRecords.isEmpty else { return }
        records = orderedUniqueRecords(cachedRecords)
        if recordLoadState == .idle { recordLoadState = .loaded(hasMore: false) }
    }

    func resetUserData() {
        dataGeneration = UUID()
        projectRequestID = nil
        proposalRequestID = nil
        deletingRecordIDs = []
        deletedRecordIDs = []
        recordActionError = nil
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
            .filter { !deletedRecordIDs.contains($0.id) && seen.insert($0.id).inserted }
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
            status: .completed,
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
