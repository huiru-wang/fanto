import Foundation
import Observation

enum RecordLoadState: Equatable {
    case idle
    case loading
    case loaded(hasMore: Bool)
    case failed(String)
}

@Observable
final class FantoStore {
    private(set) var recordStatisticsRevision = 0
    var records: [Record]
    var recordLoadState: RecordLoadState = .idle
    private(set) var recordNextCursor: String?
    private(set) var isLoadingMoreRecords = false
    private(set) var recordLoadMoreError: String?
    var recordActionError: String?
    private(set) var deletingRecordIDs = Set<String>()
    private var deletedRecordIDs = Set<String>()
    private var dataGeneration = UUID()

    private let recordSnapshotStore: RecordSnapshotStore
    private var snapshotUserID: String?

    init(
        records: [Record] = [],
        recordSnapshotStore: RecordSnapshotStore = .shared
    ) {
        self.records = records
        self.recordSnapshotStore = recordSnapshotStore
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
        recordStatisticsRevision += 1
        await saveRecordSnapshot()
        guard generation == dataGeneration else { return }
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

    func insertCreatedRecord(_ record: Record) {
        records = orderedUniqueRecords([record] + records)
        recordStatisticsRevision += 1
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
        deletingRecordIDs = []
        deletedRecordIDs = []
        recordActionError = nil
        if let snapshotUserID {
            Task { [recordSnapshotStore] in await recordSnapshotStore.clear(for: snapshotUserID) }
        }
        records = []
        recordLoadState = .idle
        recordNextCursor = nil
        isLoadingMoreRecords = false
        recordLoadMoreError = nil
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
        let store = FantoStore()
        store.recordLoadState = .loaded(hasMore: false)
        return store
    }()
}
