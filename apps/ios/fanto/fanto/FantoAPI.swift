import Foundation

struct APIEnvelope<Value: Decodable>: Decodable {
    let result: Value
    let success: Bool
    let errorCode: String?
    let errorMsg: String?
}

struct CursorPage<Value: Decodable>: Decodable {
    let data: [Value]
    let nextCursor: String?
    let hasMore: Bool
}

struct TopicReference: Decodable, Identifiable, Hashable {
    let id: String
    let title: String
    let status: String
}

struct RecordDTO: Decodable, Identifiable, Hashable {
    let id: String
    let content: String
    let status: String
    let createdAt: String
    let updatedAt: String
    let topics: [TopicReference]
}

struct TopicDTO: Decodable, Identifiable, Hashable {
    let id: String
    let title: String
    let summary: String
    let content: String
    let tags: [String]
    let status: String
    let createdAt: String
    let updatedAt: String
}

enum FantoAPIError: LocalizedError {
    case invalidBaseURL
    case invalidResponse
    case server(String)

    var errorDescription: String? {
        switch self {
        case .invalidBaseURL:
            "尚未配置服务地址。"
        case .invalidResponse:
            "服务返回的数据无法识别。"
        case let .server(message):
            message
        }
    }
}

enum AppConfiguration {
    static var baseURL: URL? {
        guard let value = Bundle.main.object(forInfoDictionaryKey: "FANTO_API_BASE_URL") as? String,
              !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return nil
        }
        return URL(string: value)
    }

    static var userID: String {
        (Bundle.main.object(forInfoDictionaryKey: "FANTO_USER_ID") as? String) ?? "default-user"
    }
}

struct FantoAPIClient {
    func records(cursor: String? = nil, topicID: String? = nil) async throws -> CursorPage<RecordDTO> {
        try await request(path: "api/records", cursor: cursor, topicID: topicID)
    }

    func record(id: String) async throws -> RecordDTO {
        try await request(path: "api/records/\(id)")
    }

    func topics(cursor: String? = nil) async throws -> CursorPage<TopicDTO> {
        try await request(path: "api/topics", cursor: cursor)
    }

    func topic(id: String) async throws -> TopicDTO {
        try await request(path: "api/topics/\(id)")
    }

    private func request<Value: Decodable>(path: String, cursor: String? = nil, topicID: String? = nil) async throws -> Value {
        guard let baseURL = AppConfiguration.baseURL else {
            throw FantoAPIError.invalidBaseURL
        }

        let endpoint = baseURL.appending(path: path)
        var components = URLComponents(url: endpoint, resolvingAgainstBaseURL: false)
        var items = [URLQueryItem(name: "limit", value: "20")]
        if let cursor { items.append(URLQueryItem(name: "cursor", value: cursor)) }
        if let topicID { items.append(URLQueryItem(name: "topicId", value: topicID)) }
        components?.queryItems = items
        guard let url = components?.url else { throw FantoAPIError.invalidBaseURL }

        var request = URLRequest(url: url)
        request.setValue(AppConfiguration.userID, forHTTPHeaderField: "x-user-id")
        request.timeoutInterval = 15

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw FantoAPIError.invalidResponse }
        let decoded = try JSONDecoder().decode(APIEnvelope<Value>.self, from: data)
        guard (200..<300).contains(http.statusCode), decoded.success else {
            throw FantoAPIError.server(decoded.errorMsg ?? "请求失败（\(http.statusCode)）。")
        }
        return decoded.result
    }
}

enum DisplayDate {
    private static let fractionalISO8601: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private static let standardISO8601 = ISO8601DateFormatter()

    private static let displayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return formatter
    }()

    static func text(_ value: String) -> String {
        guard let date = fractionalISO8601.date(from: value) ?? standardISO8601.date(from: value) else {
            return value
        }
        return displayFormatter.string(from: date)
    }
}
