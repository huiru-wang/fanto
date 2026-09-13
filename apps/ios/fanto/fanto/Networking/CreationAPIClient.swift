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

    private let userID = "creation-demo-user"

    private let baseURL = URL(string: "http://localhost:3000")!

    func fetchOverview() async throws -> CreationOverview {
        let response: OverviewPayload = try await request(path: "api/creations/overview")
        let kinds = response.kinds.map(CreationKind.init)
        let kindsByID = Dictionary(uniqueKeysWithValues: kinds.map { ($0.id, $0) })
        let tracking = response.tracking.map { $0.creation(kindsByID: kindsByID) }
        return CreationOverview(tracking: tracking, kinds: kinds)
    }

    func fetchCreation(id: String) async throws -> Creation {
        let response: CreationDetailPayload = try await request(path: "api/creations/\(id)")
        return response.creation
    }

    func fetchSourceRecords(id: String, cursor: String? = nil) async throws -> CreationSourceRecordPage {
        var components = URLComponents(url: baseURL.appending(path: "api/creations/\(id)/records"), resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "limit", value: "20")]
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

    private func request<Response: Decodable>(path: String) async throws -> Response {
        try await request(url: baseURL.appending(path: path))
    }

    private func request<Response: Decodable>(url: URL) async throws -> Response {
        var request = URLRequest(url: url)
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

    static func overview(from encoded: String) -> String {
        guard let data = encoded.data(using: .utf8),
              let summary = try? JSONDecoder().decode(Self.self, from: data)
        else { return encoded }
        return summary.overview
    }
}

private struct SourceRecordsPayload: Decodable {
    let data: [SourceRecordPayload]
    let hasMore: Bool
    let nextCursor: String?
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
