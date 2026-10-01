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
    var proposedProjects: [Project]
    var recordLoadState: RecordLoadState = .idle
    private(set) var recordNextCursor: String?
    private(set) var isLoadingMoreRecords = false
    private(set) var recordLoadMoreError: String?
    var projectLoadState: ProjectLoadState = .idle
    var proposedProjectLoadState: ProjectLoadState = .idle
    var projectActionError: String?

    private let recordSnapshotStore: RecordSnapshotStore
    private var snapshotUserID: String?

    init(
        records: [Record] = [],
        projects: [Project] = [],
        proposedProjects: [Project] = [],
        recordSnapshotStore: RecordSnapshotStore = .shared
    ) {
        self.records = records
        self.projects = projects
        self.proposedProjects = proposedProjects
        self.recordSnapshotStore = recordSnapshotStore
    }

    func loadProjects() async {
        projectLoadState = .loading
        do {
            projects = try await FantoAPIClient.shared.fetchProjects(status: .active).projects
            projectLoadState = .loaded
        } catch {
            projectLoadState = .failed(error.localizedDescription)
        }
        await loadProposedProjects()
    }

    func loadProposedProjects() async {
        proposedProjectLoadState = .loading
        do {
            proposedProjects = try await FantoAPIClient.shared.fetchProjects(status: .proposed).projects
            proposedProjectLoadState = .loaded
        } catch {
            proposedProjects = []
            proposedProjectLoadState = .failed(error.localizedDescription)
        }
    }

    func accept(_ project: Project) async -> Bool {
        do {
            _ = try await FantoAPIClient.shared.confirmProject(id: project.id)
            proposedProjects.removeAll { $0.id == project.id }
            await loadProjects()
            return true
        } catch {
            projectActionError = error.localizedDescription
            return false
        }
    }

    func decline(_ project: Project) async -> Bool {
        do {
            _ = try await FantoAPIClient.shared.rejectProject(id: project.id)
            proposedProjects.removeAll { $0.id == project.id }
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

    func addRecord(text: String, location: String?, eventAt: Date) {
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
        proposedProjects = []
        recordLoadState = .idle
        recordNextCursor = nil
        isLoadingMoreRecords = false
        recordLoadMoreError = nil
        projectLoadState = .idle
        proposedProjectLoadState = .idle
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
            content: "不是减少投入，而是让投入能被自己选择。",
            status: .active,
            version: 1,
            createdAt: .now,
            updatedAt: .now
        )
        let store = FantoStore(projects: [project])
        store.projectLoadState = .loaded
        store.proposedProjectLoadState = .loaded
        store.recordLoadState = .loaded(hasMore: false)
        return store
    }()
}
