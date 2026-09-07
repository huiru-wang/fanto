import Combine
import Foundation

@MainActor
final class RecordsModel: ObservableObject {
    @Published private(set) var records: [RecordDTO] = []
    @Published private(set) var isLoading = false
    @Published private(set) var hasMore = false
    @Published var errorMessage: String?
    private var cursor: String?

    func load(reset: Bool = false) async {
        guard !isLoading else { return }
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            let page = try await FantoAPIClient().records(cursor: reset ? nil : cursor)
            records = reset ? page.data : unique(records + page.data)
            cursor = page.nextCursor
            hasMore = page.hasMore
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func unique(_ values: [RecordDTO]) -> [RecordDTO] {
        var ids = Set<String>()
        return values.filter { ids.insert($0.id).inserted }
    }
}

@MainActor
final class TopicsModel: ObservableObject {
    @Published private(set) var topics: [TopicDTO] = []
    @Published private(set) var isLoading = false
    @Published private(set) var hasMore = false
    @Published var errorMessage: String?
    private var cursor: String?

    func load(reset: Bool = false) async {
        guard !isLoading else { return }
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            let page = try await FantoAPIClient().topics(cursor: reset ? nil : cursor)
            topics = reset ? page.data : unique(topics + page.data)
            cursor = page.nextCursor
            hasMore = page.hasMore
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func unique(_ values: [TopicDTO]) -> [TopicDTO] {
        var ids = Set<String>()
        return values.filter { ids.insert($0.id).inserted }
    }
}

@MainActor
final class RecordDetailModel: ObservableObject {
    @Published private(set) var record: RecordDTO?
    @Published private(set) var isLoading = false
    @Published var errorMessage: String?

    func load(id: String) async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do { record = try await FantoAPIClient().record(id: id) }
        catch { errorMessage = error.localizedDescription }
    }
}

@MainActor
final class TopicDetailModel: ObservableObject {
    @Published private(set) var topic: TopicDTO?
    @Published private(set) var isLoading = false
    @Published var errorMessage: String?

    func load(id: String) async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do { topic = try await FantoAPIClient().topic(id: id) }
        catch { errorMessage = error.localizedDescription }
    }
}

@MainActor
final class TopicRecordsModel: ObservableObject {
    @Published private(set) var records: [RecordDTO] = []
    @Published private(set) var isLoading = false
    @Published private(set) var hasMore = false
    @Published var errorMessage: String?
    private var cursor: String?

    func load(topicID: String, reset: Bool = false) async {
        guard !isLoading else { return }
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            let page = try await FantoAPIClient().records(cursor: reset ? nil : cursor, topicID: topicID)
            records = reset ? page.data : unique(records + page.data)
            cursor = page.nextCursor
            hasMore = page.hasMore
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func unique(_ values: [RecordDTO]) -> [RecordDTO] {
        var ids = Set<String>()
        return values.filter { ids.insert($0.id).inserted }
    }
}
