import Foundation

struct CreationOverview {
    let tracking: [Creation]
    let kinds: [CreationKind]
}

struct CreationSourceRecord: Identifiable, Hashable {
    let id: String
    let text: String
    let createdAt: Date
}

struct CreationSourceRecordPage {
    let records: [CreationSourceRecord]
    let hasMore: Bool
    let nextCursor: String?
}

struct RecordPage {
    let records: [Record]
    let hasMore: Bool
    let nextCursor: String?
}

enum CreationAPIError: LocalizedError {
    case invalidBaseURL
    case invalidResponse
    case server(String)

    var errorDescription: String? {
        switch self {
        case .invalidBaseURL: "本地服务地址无效。"
        case .invalidResponse: "服务返回的数据无法识别。"
        case let .server(message): message
        }
    }
}

struct CreationAPIClient {
    static let shared = CreationAPIClient()

    private let userID = "user001"

    private let baseURL = URL(string: "https://fanto.robinverse.me")!

    func fetchOverview() async throws -> CreationOverview {
        let response: OverviewPayload = try await request(path: "api/creations/overview")
        let kinds = response.kinds.map(CreationKind.init)
        let kindsByID = Dictionary(uniqueKeysWithValues: kinds.map { ($0.id, $0) })
        let tracking = response.tracking.map { $0.creation(kindsByID: kindsByID) }
        return CreationOverview(tracking: tracking, kinds: kinds)
    }

    func fetchRecords() async throws -> RecordPage {
        var components = URLComponents(url: baseURL.appending(path: "api/records"), resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "limit", value: "100")]
        guard let url = components?.url else { throw CreationAPIError.invalidBaseURL }
        let response: RecordsPayload = try await request(url: url)
        return RecordPage(
            records: response.data.map(Record.init),
            hasMore: response.hasMore,
            nextCursor: response.nextCursor
        )
    }

    func fetchMediaReadURL(id: String) async throws -> URL {
        let response: MediaReadURLPayload = try await request(path: "api/media/\(id)/url")
        guard let url = URL(string: response.url) else { throw CreationAPIError.invalidResponse }
        return url
    }

    func fetchCreation(id: String) async throws -> Creation {
        let response: CreationDetailPayload = try await request(path: "api/creations/\(id)")
        return response.creation
    }

    func fetchCreations(kind: CreationKind) async throws -> [Creation] {
        var components = URLComponents(url: baseURL.appending(path: "api/creations"), resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "kindId", value: kind.id)]
        guard let url = components?.url else { throw CreationAPIError.invalidBaseURL }
        let response: CreationListPayload = try await request(url: url)
        return response.data.map { $0.creation(kind: kind) }
    }

    func fetchProposals() async throws -> [Proposal] {
        var components = URLComponents(url: baseURL.appending(path: "api/creation-proposals"), resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "status", value: "pending_confirmation")]
        guard let url = components?.url else { throw CreationAPIError.invalidBaseURL }
        let response: ProposalListPayload = try await request(url: url)
        return response.data.compactMap(Proposal.init)
    }

    func fetchProposal(id: String) async throws -> Proposal {
        let response: ProposalPayload = try await request(path: "api/creation-proposals/\(id)")
        guard let proposal = Proposal(response) else { throw CreationAPIError.invalidResponse }
        return proposal
    }

    func confirmProposal(id: String) async throws {
        let _: ProposalDecisionPayload = try await request(path: "api/creation-proposals/\(id)/confirm", method: "POST")
    }

    func rejectProposal(id: String) async throws {
        let _: ProposalDecisionPayload = try await request(path: "api/creation-proposals/\(id)/reject", method: "POST")
    }

    func fetchSourceRecords(id: String, cursor: String? = nil) async throws -> CreationSourceRecordPage {
        var components = URLComponents(url: baseURL.appending(path: "api/creations/\(id)/records"), resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "limit", value: "5")]
        if let cursor {
            components?.queryItems?.append(URLQueryItem(name: "cursor", value: cursor))
        }
        guard let url = components?.url else { throw CreationAPIError.invalidBaseURL }
        let response: SourceRecordsPayload = try await request(url: url)
        return CreationSourceRecordPage(
            records: response.data.map(CreationSourceRecord.init),
            hasMore: response.hasMore,
            nextCursor: response.nextCursor
        )
    }

    private func request<Response: Decodable>(path: String, method: String = "GET") async throws -> Response {
        try await request(url: baseURL.appending(path: path), method: method)
    }

    private func request<Response: Decodable>(url: URL, method: String = "GET") async throws -> Response {
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue(userID, forHTTPHeaderField: "x-user-id")
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw CreationAPIError.invalidResponse }
        let decoded = try decoder.decode(APIEnvelope<Response>.self, from: data)
        guard (200 ... 299).contains(http.statusCode), decoded.success else {
            throw CreationAPIError.server(decoded.errorMsg ?? "服务暂时不可用。")
        }
        guard let result = decoded.result else { throw CreationAPIError.invalidResponse }
        return result
    }

    private var decoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let value = try container.decode(String.self)
            if let date = ISO8601DateFormatter.fanto.date(from: value) { return date }
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Invalid API date")
        }
        return decoder
    }
}

private struct APIEnvelope<Result: Decodable>: Decodable {
    let success: Bool
    let result: Result?
    let errorMsg: String?
}

private struct KindPayload: Decodable {
    let kindID: String
    let name: String
    let title: String

    enum CodingKeys: String, CodingKey {
        case kindID = "kind_id"
        case name
        case title
    }
}

private extension CreationKind {
    init(_ payload: KindPayload) {
        self.init(id: payload.kindID, name: payload.name, title: payload.title)
    }
}

private struct OverviewPayload: Decodable {
    let tracking: [OverviewCreationPayload]
    let kinds: [KindPayload]
}

private struct OverviewCreationPayload: Decodable {
    let creationID: String
    let title: String
    let kindID: String
    let summary: String
    let status: String
    let updatedAt: Date

    enum CodingKeys: String, CodingKey {
        case creationID = "creation_id"
        case title
        case kindID = "kind_id"
        case summary
        case status
        case updatedAt = "updated_at"
    }

    func creation(kindsByID: [String: CreationKind]) -> Creation {
        Creation(
            id: creationID,
            kind: kindsByID[kindID] ?? CreationKind(id: kindID, name: "unknown", title: "未分类"),
            title: title,
            summary: SummaryPayload.overview(from: summary),
            updatedAt: updatedAt,
            status: CreationStatus(apiValue: status)
        )
    }
}

private struct CreationDetailPayload: Decodable {
    let creationID: String
    let title: String
    let kindID: String
    let kindName: String
    let kindTitle: String
    let summary: SummaryPayload
    let content: String
    let status: String
    let updatedAt: Date

    enum CodingKeys: String, CodingKey {
        case creationID = "creation_id"
        case title
        case kindID = "kind_id"
        case kindName = "kind_name"
        case kindTitle = "kind_title"
        case summary
        case content
        case status
        case updatedAt = "updated_at"
    }

    var creation: Creation {
        Creation(
            id: creationID,
            kind: CreationKind(id: kindID, name: kindName, title: kindTitle),
            title: title,
            summary: summary.overview,
            updatedAt: updatedAt,
            status: CreationStatus(apiValue: status),
            content: content
        )
    }
}

private struct SummaryPayload: Decodable {
    let overview: String

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let text = try? container.decode(String.self) { overview = text; return }
        overview = try container.decode(Legacy.self).overview
    }

    private struct Legacy: Decodable { let overview: String }

    static func overview(from encoded: String) -> String {
        guard let data = encoded.data(using: .utf8),
              let summary = try? JSONDecoder().decode(Self.self, from: data)
        else { return encoded }
        return summary.overview
    }
}

private struct CreationListPayload: Decodable { let data: [CreationListItemPayload] }
private struct CreationListItemPayload: Decodable {
    let creationID: String; let title: String; let summary: String; let status: String; let updatedAt: Date
    enum CodingKeys: String, CodingKey { case creationID = "creation_id"; case title, summary, status; case updatedAt = "updated_at" }
    func creation(kind: CreationKind) -> Creation { Creation(id: creationID, kind: kind, title: title, summary: SummaryPayload.overview(from: summary), updatedAt: updatedAt, status: CreationStatus(apiValue: status)) }
}

private struct SourceRecordsPayload: Decodable {
    let data: [SourceRecordPayload]
    let hasMore: Bool
    let nextCursor: String?
}

private struct ProposalListPayload: Decodable {
    let data: [ProposalPayload]
}

private struct ProposalPayload: Decodable {
    let proposalID: String
    let title: String?
    let kind: ProposalKindPayload?
    let summary: ProposalSummaryPayload?
    let content: String?
    let sourceCount: Int
    let createdAt: Date?
    let sources: [ProposalSourceRecordPayload]?

    enum CodingKeys: String, CodingKey {
        case proposalID = "proposalId"
        case title, kind, summary, content, sourceCount, createdAt, sources
    }
}

private enum ProposalSummaryPayload: Decodable {
    case text(String)
    case structured(SummaryPayload)

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let text = try? container.decode(String.self) {
            self = .text(text)
        } else {
            self = .structured(try container.decode(SummaryPayload.self))
        }
    }

    var overview: String {
        switch self {
        case let .text(text): text
        case let .structured(summary): summary.overview
        }
    }
}

private struct ProposalKindPayload: Decodable {
    let kindID: String
    let name: String
    let title: String

    enum CodingKeys: String, CodingKey {
        case kindID = "kindId"
        case name, title
    }
}

private struct ProposalDecisionPayload: Decodable {
    let proposalID: String

    enum CodingKeys: String, CodingKey {
        case proposalID = "proposalId"
    }
}

private struct ProposalSourceRecordPayload: Decodable {
    let recordID: String
    let content: String
    let createdAt: Date

    enum CodingKeys: String, CodingKey {
        case recordID = "record_id"
        case content
        case createdAt = "created_at"
    }
}

private extension Proposal {
    init?(_ payload: ProposalPayload) {
        guard let title = payload.title, let kind = payload.kind else { return nil }
        self.init(
            id: payload.proposalID,
            kind: CreationKind(id: kind.kindID, name: kind.name, title: kind.title),
            title: title,
            insight: payload.summary?.overview ?? "这是一条等待确认的观察。",
            evidence: payload.content ?? "暂未提供更多依据。",
            sourceCount: payload.sourceCount,
            suggestedNextStep: "长期跟踪后，继续在脉络中积累。",
            createdAt: payload.createdAt,
            sourceRecords: (payload.sources ?? []).map(ProposalSourceRecord.init)
        )
    }
}

private extension ProposalSourceRecord {
    init(_ payload: ProposalSourceRecordPayload) {
        self.init(
            id: payload.recordID,
            text: RecordContentPayload.text(from: payload.content),
            createdAt: payload.createdAt
        )
    }
}

private struct SourceRecordPayload: Decodable {
    let recordID: String
    let content: String
    let createdAt: Date

    enum CodingKeys: String, CodingKey {
        case recordID = "record_id"
        case content
        case createdAt = "created_at"
    }
}

private extension CreationSourceRecord {
    init(_ payload: SourceRecordPayload) {
        let text = RecordContentPayload.text(from: payload.content)
        self.init(id: payload.recordID, text: text, createdAt: payload.createdAt)
    }
}

private struct RecordContentPayload: Decodable {
    let text: String

    static func text(from encoded: String) -> String {
        guard let data = encoded.data(using: .utf8),
              let record = try? JSONDecoder().decode(Self.self, from: data)
        else { return encoded }
        return record.text
    }
}

private struct RecordsPayload: Decodable {
    let data: [RecordPayload]
    let hasMore: Bool
    let nextCursor: String?
}

private struct RecordPayload: Decodable {
    let id: String
    let content: RecordContentPayload
    let eventAt: Date
    let media: [RecordMediaPayload]

    enum CodingKeys: String, CodingKey {
        case id
        case content
        case eventAt
        case media
    }
}

private struct RecordMediaPayload: Decodable {
    let mediaID: String
    let type: String
    let durationMs: Int?

    enum CodingKeys: String, CodingKey {
        case mediaID = "mediaId"
        case type
        case durationMs
    }
}

private struct MediaReadURLPayload: Decodable {
    let url: String
}

private extension Record {
    init(_ payload: RecordPayload) {
        let images = payload.media
            .filter { $0.type == "image" }
            .map { RecordPhoto(id: $0.mediaID) }
        let audio = payload.media.first { $0.type == "audio" }
        let media: RecordMedia? = if let audio {
            RecordMedia.audio(duration: TimeInterval(audio.durationMs ?? 0) / 1_000)
        } else if !images.isEmpty {
            RecordMedia.photos(images)
        } else {
            nil
        }

        self.init(id: payload.id, text: payload.content.text, eventAt: payload.eventAt, media: media)
    }
}

private extension CreationStatus {
    init(apiValue: String) {
        switch apiValue {
        case "active": self = .active
        case "resting": self = .resting
        default: self = .archived
        }
    }
}

private extension ISO8601DateFormatter {
    static let fanto: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}
