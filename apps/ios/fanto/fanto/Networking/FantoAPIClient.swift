import Foundation

struct RecordPage {
    let records: [Record]
    let hasMore: Bool
    let nextCursor: String?
}

nonisolated enum MediaReadVariant: String, Sendable {
    case thumbnail
    case original
}

enum FantoAPIError: LocalizedError {
    case invalidBaseURL
    case invalidResponse
    case server(String, code: String?)

    var code: String? {
        if case let .server(_, code) = self { return code }
        return nil
    }

    var errorDescription: String? {
        switch self {
        case .invalidBaseURL: "本地服务地址无效。"
        case .invalidResponse: "服务返回的数据无法识别。"
        case let .server(message, _): message
        }
    }
}

struct FantoAPIClient {
    static let shared = FantoAPIClient()

    private let baseURL = URL(string: "https://fanto.robinverse.me")!

    func fetchUserProfile() async throws -> UserProfile {
        try await request(path: "api/users/me/profile")
    }
    func updateUserProfile(version: Int, changes: UserProfileChanges) async throws -> UserProfile {
        struct Payload: Encodable { let expectedVersion: Int; let changes: UserProfileChanges }
        return try await request(path: "api/users/me/profile", method: "PATCH", body: JSONEncoder().encode(Payload(expectedVersion: version, changes: changes)))
    }
    func fetchUserStatistics() async throws -> UserStatistics {
        var components = URLComponents(url: baseURL.appending(path: "api/users/me/statistics"), resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "timeZone", value: TimeZone.current.identifier)]
        guard let url = components?.url else { throw FantoAPIError.invalidBaseURL }
        return try await request(url: url)
    }
    func fetchAccountInfo() async throws -> AccountInfo { try await request(path: "api/users/me") }

    func fetchFantoSettings() async throws -> FantoSettings {
        try await request(path: "api/fanto/settings")
    }

    func updateFantoSettings(version: Int, changes: FantoSettingsChanges) async throws -> FantoSettings {
        struct Payload: Encodable { let expectedVersion: Int; let changes: FantoSettingsChanges }
        return try await request(path: "api/fanto/settings", method: "PATCH", body: JSONEncoder().encode(Payload(expectedVersion: version, changes: changes)))
    }

    func fetchRecords(cursor: String? = nil, limit: Int = 30) async throws -> RecordPage {
        var components = URLComponents(url: baseURL.appending(path: "api/records"), resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "limit", value: String(limit))]
        if let cursor { components?.queryItems?.append(URLQueryItem(name: "cursor", value: cursor)) }
        guard let url = components?.url else { throw FantoAPIError.invalidBaseURL }
        let response: RecordsPayload = try await request(url: url)
        return RecordPage(records: response.data.map(Record.init), hasMore: response.hasMore, nextCursor: response.nextCursor)
    }

    func fetchRecord(id: String) async throws -> Record {
        Record(try await request(path: "api/records/\(id)") as RecordPayload)
    }

    func deleteRecord(id: String, expectedVersion: Int) async throws {
        let body = try JSONEncoder().encode(["expectedVersion": expectedVersion])
        let _: DeletedRecordPayload = try await request(path: "api/records/\(id)", method: "DELETE", body: body)
    }

    func fetchMediaReadURL(id: String, variant: MediaReadVariant = .original) async throws -> URL {
        try await MediaImageCache.shared.readURL(id: id, variant: variant)
    }

    func fetchMediaReadLocation(id: String, variant: MediaReadVariant) async throws -> MediaReadLocation {
        var components = URLComponents(url: baseURL.appending(path: "api/media/\(id)/url"), resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "variant", value: variant.rawValue)]
        guard let url = components?.url else { throw FantoAPIError.invalidBaseURL }
        let response: MediaReadURLPayload = try await request(url: url)
        guard let readURL = URL(string: response.url) else { throw FantoAPIError.invalidResponse }
        return MediaReadLocation(url: readURL, expiresAt: response.expiresAt)
    }

    private func request<Response: Decodable>(path: String, method: String = "GET", body: Data? = nil) async throws -> Response {
        try await request(url: baseURL.appending(path: path), method: method, body: body)
    }

    private func request<Response: Decodable>(url: URL, method: String = "GET", body: Data? = nil) async throws -> Response {
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)
        request.httpMethod = method
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let token = try await AuthSession.shared.sessionToken()
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw FantoAPIError.invalidResponse }
        if http.statusCode == 401 { await AuthSession.shared.invalidate(); throw AuthenticationError.expired }
        guard (200 ... 299).contains(http.statusCode) else {
            let failure = try? decoder.decode(APIErrorPayload.self, from: data)
            throw FantoAPIError.server(failure?.errorMsg ?? "服务暂时不可用。", code: failure?.errorCode)
        }
        let decoded = try decoder.decode(APIEnvelope<Response>.self, from: data)
        guard decoded.success else {
            throw FantoAPIError.server(decoded.errorMsg ?? "服务暂时不可用。", code: decoded.errorCode)
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
    let errorCode: String?
}

private struct DeletedRecordPayload: Decodable { let recordId: String }
private struct APIErrorPayload: Decodable { let errorMsg: String?; let errorCode: String? }

private struct RecordsPayload: Decodable {
    let data: [RecordPayload]
    let hasMore: Bool
    let nextCursor: String?
}

private struct RecordPayload: Decodable {
    let id: String
    let version: Int
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
        self.init(id: payload.id, text: payload.content.text, eventAt: payload.eventAt, location: location, media: parsedMedia.isEmpty ? nil : parsedMedia, version: payload.version)
    }
}

nonisolated struct MediaReadLocation: Sendable { let url: URL; let expiresAt: Date }
private struct MediaReadURLPayload: Decodable { let url: String; let expiresAt: Date }

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
