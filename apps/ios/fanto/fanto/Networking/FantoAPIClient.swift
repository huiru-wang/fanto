import Foundation

struct ProjectPage {
    let projects: [Project]
    let hasMore: Bool
    let nextCursor: String?
}

struct ProjectRecordPage {
    let records: [Record]
    let hasMore: Bool
    let nextCursor: String?
}

struct RecordPage {
    let records: [Record]
    let hasMore: Bool
    let nextCursor: String?
}

enum MediaReadVariant: String {
    case thumbnail
    case original
}

enum FantoAPIError: LocalizedError {
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

struct FantoAPIClient {
    static let shared = FantoAPIClient()

    private let baseURL = URL(string: "https://fanto.robinverse.me")!

    func fetchProjects(status: ProjectStatus? = nil, cursor: String? = nil, limit: Int = 100) async throws -> ProjectPage {
        var components = URLComponents(url: baseURL.appending(path: "api/projects"), resolvingAgainstBaseURL: false)
        var items = [URLQueryItem(name: "limit", value: String(limit))]
        if let status { items.append(URLQueryItem(name: "status", value: status.rawValue)) }
        if let cursor { items.append(URLQueryItem(name: "cursor", value: cursor)) }
        components?.queryItems = items
        guard let url = components?.url else { throw FantoAPIError.invalidBaseURL }
        let response: ProjectsPayload = try await request(url: url)
        return ProjectPage(projects: response.data.map(Project.init), hasMore: response.hasMore, nextCursor: response.nextCursor)
    }

    func fetchProject(id: String) async throws -> Project {
        Project(try await request(path: "api/projects/\(id)") as ProjectPayload)
    }

    func fetchProjectRecords(id: String, cursor: String? = nil, limit: Int = 5) async throws -> ProjectRecordPage {
        var components = URLComponents(url: baseURL.appending(path: "api/projects/\(id)/records"), resolvingAgainstBaseURL: false)
        var items = [URLQueryItem(name: "limit", value: String(limit))]
        if let cursor { items.append(URLQueryItem(name: "cursor", value: cursor)) }
        components?.queryItems = items
        guard let url = components?.url else { throw FantoAPIError.invalidBaseURL }
        let response: ProjectRecordsPayload = try await request(url: url)
        return ProjectRecordPage(records: response.data.map(Record.init), hasMore: response.hasMore, nextCursor: response.nextCursor)
    }

    func confirmProject(id: String) async throws -> Project {
        Project(try await request(path: "api/projects/\(id)/confirm", method: "POST") as ProjectPayload)
    }

    func rejectProject(id: String) async throws -> Project {
        Project(try await request(path: "api/projects/\(id)/reject", method: "POST") as ProjectPayload)
    }

    func fetchRecords(cursor: String? = nil, limit: Int = 30) async throws -> RecordPage {
        var components = URLComponents(url: baseURL.appending(path: "api/records"), resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "limit", value: String(limit))]
        if let cursor { components?.queryItems?.append(URLQueryItem(name: "cursor", value: cursor)) }
        guard let url = components?.url else { throw FantoAPIError.invalidBaseURL }
        let response: RecordsPayload = try await request(url: url)
        return RecordPage(records: response.data.map(Record.init), hasMore: response.hasMore, nextCursor: response.nextCursor)
    }

    func fetchMediaReadURL(id: String, variant: MediaReadVariant = .original) async throws -> URL {
        var components = URLComponents(url: baseURL.appending(path: "api/media/\(id)/url"), resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "variant", value: variant.rawValue)]
        guard let url = components?.url else { throw FantoAPIError.invalidBaseURL }
        let response: MediaReadURLPayload = try await request(url: url)
        guard let readURL = URL(string: response.url) else { throw FantoAPIError.invalidResponse }
        return readURL
    }

    private func request<Response: Decodable>(path: String, method: String = "GET") async throws -> Response {
        try await request(url: baseURL.appending(path: path), method: method)
    }

    private func request<Response: Decodable>(url: URL, method: String = "GET") async throws -> Response {
        var request = URLRequest(url: url)
        request.httpMethod = method
        let token = try await AuthSession.shared.accessToken()
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw FantoAPIError.invalidResponse }
        let decoded = try decoder.decode(APIEnvelope<Response>.self, from: data)
        guard (200 ... 299).contains(http.statusCode), decoded.success else {
            throw FantoAPIError.server(decoded.errorMsg ?? "服务暂时不可用。")
        }
        guard let result = decoded.result else { throw FantoAPIError.invalidResponse }
        return result
    }

    private var decoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let value = try container.decode(String.self)
            if let date = ISO8601DateFormatter.fantoFractional.date(from: value) ?? ISO8601DateFormatter.fantoBasic.date(from: value) { return date }
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

private struct ProjectsPayload: Decodable {
    let data: [ProjectPayload]
    let hasMore: Bool
    let nextCursor: String?
}

private struct ProjectPayload: Decodable {
    let projectId: String
    let title: String
    let content: String
    let status: ProjectStatus
    let version: Int
    let createdAt: Date
    let updatedAt: Date
}

private extension Project {
    init(_ payload: ProjectPayload) {
        self.init(id: payload.projectId, title: payload.title, content: payload.content, status: payload.status, version: payload.version, createdAt: payload.createdAt, updatedAt: payload.updatedAt)
    }
}

private struct ProjectRecordsPayload: Decodable {
    let data: [RecordPayload]
    let hasMore: Bool
    let nextCursor: String?
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
}

private struct RecordContentPayload: Decodable {
    let text: String
    let blocks: [RecordContentBlockPayload]?
}

private struct RecordContentBlockPayload: Decodable {
    let type: String
    let mediaId: String?
    let durationMs: Int?
    let name: String?
    let countryCode: String?
    let country: String?
    let province: String?
    let city: String?
    let district: String?
    let latitude: Double?
    let longitude: Double?
}

private extension Record {
    init(_ payload: RecordPayload) {
        let blocks = payload.content.blocks ?? []
        let images = blocks.compactMap { block in
            block.type == "image" && block.mediaId != nil ? RecordPhoto(id: block.mediaId!) : nil
        }
        let audio = blocks.first { $0.type == "audio" && $0.mediaId != nil }.map { block in
            RecordAudio(id: block.mediaId!, duration: TimeInterval(block.durationMs ?? 0) / 1_000)
        }
        let location: RecordLocation?
        if let block = blocks.first(where: { $0.type == "location" }),
           let name = block.name,
           let latitude = block.latitude,
           let longitude = block.longitude {
            location = RecordLocation(
                name: name,
                countryCode: block.countryCode,
                country: block.country,
                province: block.province,
                city: block.city,
                district: block.district,
                latitude: latitude,
                longitude: longitude
            )
        } else {
            location = nil
        }
        let parsedMedia = RecordMedia(photos: images, audio: audio)
        self.init(id: payload.id, text: payload.content.text, eventAt: payload.eventAt, location: location, media: parsedMedia.isEmpty ? nil : parsedMedia)
    }
}

private struct MediaReadURLPayload: Decodable { let url: String }

private extension ISO8601DateFormatter {
    static let fantoFractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
    static let fantoBasic: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()
}
