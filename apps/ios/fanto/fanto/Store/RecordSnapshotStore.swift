import Foundation

actor RecordSnapshotStore {
    static let shared = RecordSnapshotStore()

    private let fileManager = FileManager.default
    private let maximumRecordCount = 200

    func load(for userID: String) -> [Record] {
        do {
            let url = try snapshotURL(for: userID)
            guard fileManager.fileExists(atPath: url.path) else { return [] }
            let data = try Data(contentsOf: url)
            let snapshot = try JSONDecoder().decode(RecordSnapshot.self, from: data)
            guard snapshot.version == 1 else { return [] }
            return snapshot.records
        } catch {
            if let url = try? snapshotURL(for: userID) {
                try? fileManager.removeItem(at: url)
            }
            return []
        }
    }

    func save(_ records: [Record], for userID: String) {
        do {
            let url = try snapshotURL(for: userID)
            let snapshot = RecordSnapshot(
                version: 1,
                records: Array(records.prefix(maximumRecordCount))
            )
            let data = try JSONEncoder().encode(snapshot)
            try data.write(to: url, options: .atomic)
            try fileManager.setAttributes(
                [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
                ofItemAtPath: url.path
            )
        } catch {
            // A snapshot is only an optional performance optimization. The next network read
            // remains authoritative, so a local file failure must not affect the UI.
        }
    }

    func clear(for userID: String) {
        guard let url = try? snapshotURL(for: userID) else { return }
        try? fileManager.removeItem(at: url)
    }

    private func snapshotURL(for userID: String) throws -> URL {
        let directory = try fileManager.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        ).appending(path: "RecordSnapshots", directoryHint: .isDirectory)
        try fileManager.createDirectory(
            at: directory,
            withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
        )
        return directory.appending(path: "records-\(fileComponent(for: userID)).json")
    }

    private func fileComponent(for userID: String) -> String {
        userID.utf8.map { String(format: "%02x", $0) }.joined()
    }
}

private struct RecordSnapshot: Codable {
    let version: Int
    let records: [Record]
}
