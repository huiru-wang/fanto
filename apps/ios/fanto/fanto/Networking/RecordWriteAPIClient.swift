import Foundation

struct DraftMediaUpload {
    let data: Data
    let mimeType: String
    let capture: MediaCapturePayload
}

struct MediaCapturePayload: Encodable {
    let width: Int?
    let height: Int?
    let durationMs: Int?

    init(width: Int? = nil, height: Int? = nil, durationMs: Int? = nil) {
        self.width = width
        self.height = height
        self.durationMs = durationMs
    }
}

enum RecordWriteAPIError: LocalizedError {
    case invalidResponse
    case invalidUploadURL
    case server(String)
    case uploadFailed(Int)

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            "服务返回的数据无法识别。"
        case .invalidUploadURL:
            "附件上传地址无效。"
        case let .server(message):
            message
        case let .uploadFailed(status):
            "附件上传失败（\(status)）。"
        }
    }
}

struct RecordWriteAPIClient {
    static let shared = RecordWriteAPIClient()

    private static let iso8601Formatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private let baseURL = URL(string: "https://fanto.robinverse.me")!

    func upload(_ media: DraftMediaUpload) async throws -> String {
        if media.mimeType.hasPrefix("image/") && media.data.count > 10 * 1024 * 1024 {
            throw RecordWriteAPIError.server("图片不能超过 10MB")
        }
        let ticket: UploadTicketPayload = try await authenticatedRequest(
            url: baseURL.appending(path: "api/uploads"),
            method: "POST",
            body: UploadRequestPayload(mimeType: media.mimeType, bytes: media.data.count)
        )

        guard let uploadURL = URL(string: ticket.uploadUrl) else {
            throw RecordWriteAPIError.invalidUploadURL
        }

        var uploadRequest = URLRequest(url: uploadURL)
        uploadRequest.httpMethod = "PUT"
        uploadRequest.httpBody = media.data
        uploadRequest.setValue(media.mimeType, forHTTPHeaderField: "Content-Type")
        let (_, uploadResponse) = try await URLSession.shared.data(for: uploadRequest)
        guard let uploadHTTP = uploadResponse as? HTTPURLResponse,
              (200 ... 299).contains(uploadHTTP.statusCode) else {
            throw RecordWriteAPIError.uploadFailed((uploadResponse as? HTTPURLResponse)?.statusCode ?? -1)
        }

        let _: UploadCompletePayload = try await authenticatedRequest(
            url: baseURL.appending(path: "api/uploads/\(ticket.mediaId)/complete"),
            method: "POST",
            body: UploadCompleteRequestPayload(capture: media.capture)
        )
        return ticket.mediaId
    }

    func createRecord(text: String, mediaIds: [String], location: RecordLocation?, eventAt: Date) async throws {
        let _: CreatedRecordPayload = try await authenticatedRequest(
            url: baseURL.appending(path: "api/records"),
            method: "POST",
            body: CreateRecordRequestPayload(
                text: text,
                media: mediaIds.map { .init(mediaId: $0) },
                location: location,
                source: "ios",
                eventAt: Self.iso8601Formatter.string(from: eventAt)
            )
        )
    }

    private func authenticatedRequest<Response: Decodable, Body: Encodable>(
        url: URL,
        method: String,
        body: Body
    ) async throws -> Response {
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let token = try await AuthSession.shared.accessToken()
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw RecordWriteAPIError.invalidResponse
        }

        let decoded = try JSONDecoder().decode(WriteAPIEnvelope<Response>.self, from: data)
        guard (200 ... 299).contains(http.statusCode), decoded.success else {
            throw RecordWriteAPIError.server(decoded.errorMsg ?? "服务暂时不可用。")
        }
        guard let result = decoded.result else {
            throw RecordWriteAPIError.invalidResponse
        }
        return result
    }
}

private struct WriteAPIEnvelope<Result: Decodable>: Decodable {
    let success: Bool
    let result: Result?
    let errorMsg: String?
}

private struct UploadRequestPayload: Encodable {
    let mimeType: String
    let bytes: Int
}

private struct UploadTicketPayload: Decodable {
    let mediaId: String
    let uploadUrl: String
}

private struct UploadCompleteRequestPayload: Encodable {
    let capture: MediaCapturePayload
}

private struct UploadCompletePayload: Decodable {
    let mediaId: String
}

private struct CreateRecordRequestPayload: Encodable {
    struct MediaReference: Encodable {
        let mediaId: String
    }

    let text: String
    let media: [MediaReference]
    let location: RecordLocation?
    let source: String
    let eventAt: String
}

private struct CreatedRecordPayload: Decodable {
    let id: String
}
