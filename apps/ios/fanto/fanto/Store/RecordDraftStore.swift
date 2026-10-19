import CryptoKit
import Foundation

nonisolated struct RecordDraftPhoto: Sendable {
    let id: UUID
    let data: Data
    let width: Int
    let height: Int
    let mediaID: String?
}

nonisolated struct RecordComposerDraft: Sendable {
    let text: String
    let eventAt: Date
    let location: RecordLocation?
    let acceptsLocationSuggestion: Bool
    let photos: [RecordDraftPhoto]
}

/// Unsaved work belongs in Application Support, separately from disposable caches.
actor RecordDraftStore {
    static let shared = RecordDraftStore()
    private let root: URL
    private var scope: AccountCacheScope?

    init(root: URL = URL.applicationSupportDirectory.appending(path: "RecordDrafts/v1")) { self.root = root }
    func activate(_ scope: AccountCacheScope) { self.scope = scope }

    func load(scope: AccountCacheScope) throws -> RecordComposerDraft? {
        guard self.scope == scope else { throw CancellationError() }
        let directory = directory(scope)
        let file = directory.appending(path: "draft.json")
        guard FileManager.default.fileExists(atPath: file.path) else { return nil }
        let document = try JSONDecoder().decode(Document.self, from: Data(contentsOf: file))
        guard document.version == 1, document.photos.count <= 5 else { throw CocoaError(.fileReadCorruptFile) }
        let photos = try document.photos.map { photo in
            RecordDraftPhoto(id: photo.id, data: try Data(contentsOf: directory.appending(path: "\(photo.id).jpg")),
                             width: photo.width, height: photo.height, mediaID: photo.mediaID)
        }
        return RecordComposerDraft(text: document.text, eventAt: document.eventAt, location: document.location,
                                   acceptsLocationSuggestion: document.acceptsLocationSuggestion, photos: photos)
    }

    func save(_ draft: RecordComposerDraft, scope: AccountCacheScope) throws {
        guard self.scope == scope else { throw CancellationError() }
        let directory = directory(scope)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        for photo in draft.photos {
            let file = directory.appending(path: "\(photo.id).jpg")
            if !FileManager.default.fileExists(atPath: file.path) {
                try photo.data.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            }
        }
        let document = Document(version: 1, text: draft.text, eventAt: draft.eventAt, location: draft.location,
            acceptsLocationSuggestion: draft.acceptsLocationSuggestion,
            photos: draft.photos.map { Photo(id: $0.id, width: $0.width, height: $0.height, mediaID: $0.mediaID) })
        try JSONEncoder().encode(document).write(to: directory.appending(path: "draft.json"),
            options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        let retained = Set(draft.photos.map { "\($0.id).jpg" }).union(["draft.json"])
        for file in try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
            where !retained.contains(file.lastPathComponent) {
            try? FileManager.default.removeItem(at: file)
        }
    }

    func clear(scope: AccountCacheScope) throws {
        guard self.scope == scope else { throw CancellationError() }
        let directory = directory(scope)
        if FileManager.default.fileExists(atPath: directory.path) { try FileManager.default.removeItem(at: directory) }
    }

    private func directory(_ scope: AccountCacheScope) -> URL {
        let key = SHA256.hash(data: Data(scope.userID.utf8)).map { String(format: "%02x", $0) }.joined()
        return root.appending(path: key)
    }
    private struct Photo: Codable { let id: UUID; let width: Int; let height: Int; let mediaID: String? }
    private struct Document: Codable {
        let version: Int; let text: String; let eventAt: Date; let location: RecordLocation?
        let acceptsLocationSuggestion: Bool; let photos: [Photo]
    }
}

/// Queue before dismissing; reopening waits for the last snapshot, and clear follows all pending writes.
@MainActor
final class RecordDraftPersistence {
    static let shared = RecordDraftPersistence()
    private var pending: Task<Void, Error>?
    private let disk: RecordDraftStore
    init(disk: RecordDraftStore = .shared) { self.disk = disk }

    func save(_ draft: RecordComposerDraft, scope: AccountCacheScope) {
        let previous = pending
        pending = Task {
            _ = try? await previous?.value
            try await disk.save(draft, scope: scope)
        }
    }
    func load(scope: AccountCacheScope) async throws -> RecordComposerDraft? {
        _ = try? await pending?.value
        return try await disk.load(scope: scope)
    }
    func clear(scope: AccountCacheScope) async throws {
        let previous = pending
        let task = Task {
            _ = try? await previous?.value
            try await disk.clear(scope: scope)
        }
        pending = task
        try await task.value
    }
}
