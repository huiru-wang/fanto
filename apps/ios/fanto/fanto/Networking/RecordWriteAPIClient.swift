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
    case api(String, String?)
    case uploadFailed(Int)

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            "服务返回的数据无法识别。"
        case .invalidUploadURL:
            "附件上传地址无效。"
        case let .server(message), let .api(message, _):
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

    func upload(_ media: DraftMediaUpload, progress: MediaUploadProgress?, onProgress: (MediaUploadProgress) -> Void) async throws -> String {
        if media.mimeType.hasPrefix("image/") && media.data.count > 10 * 1024 * 1024 {
            throw RecordWriteAPIError.server("图片不能超过 10MB")
        }
        var progress = progress
        if let current = progress, current.stage == .ready { return current.ticket.mediaId }
        if var current = progress, current.stage == .uploading {
            do {
                try await complete(media, ticket: current.ticket)
                current.stage = .ready
                onProgress(current)
                return current.ticket.mediaId
            } catch RecordWriteAPIError.api(_, let code) where code == "UPLOAD_NOT_FOUND" {
                current.stage = .ticket
                progress = current
                onProgress(current)
            }
        }
        let expired = progress.map { $0.stage == .ticket && (Self.iso8601Formatter.date(from: $0.ticket.expiresAt) ?? .distantPast) <= Date.now } ?? true
        if expired {
            let ticket: UploadTicketPayload = try await authenticatedRequest(
                url: baseURL.appending(path: "api/uploads"), method: "POST",
                body: UploadRequestPayload(mimeType: media.mimeType, bytes: media.data.count)
            )
            let created = MediaUploadProgress(ticket: ticket, stage: .ticket)
            progress = created
            onProgress(created)
        }
        guard var current = progress else { throw RecordWriteAPIError.invalidResponse }
        let ticket = current.ticket
        if current.stage == .ticket {
            guard let uploadURL = URL(string: ticket.uploadUrl) else {
                throw RecordWriteAPIError.invalidUploadURL
            }

            current.stage = .uploading
            onProgress(current)
            var uploadRequest = URLRequest(url: uploadURL)
            uploadRequest.timeoutInterval = 60
            uploadRequest.httpMethod = "PUT"
            uploadRequest.httpBody = media.data
            uploadRequest.setValue(media.mimeType, forHTTPHeaderField: "Content-Type")
            let (_, uploadResponse) = try await URLSession.shared.data(for: uploadRequest)
            guard let uploadHTTP = uploadResponse as? HTTPURLResponse,
                  (200 ... 299).contains(uploadHTTP.statusCode) else {
                throw RecordWriteAPIError.uploadFailed((uploadResponse as? HTTPURLResponse)?.statusCode ?? -1)
            }

            current.stage = .uploaded
            onProgress(current)
        }
        try await complete(media, ticket: ticket)
        current.stage = .ready
        onProgress(current)
        return ticket.mediaId
    }

    private func complete(_ media: DraftMediaUpload, ticket: UploadTicketPayload) async throws {
        let _: UploadCompletePayload = try await authenticatedRequest(
            url: baseURL.appending(path: "api/uploads/\(ticket.mediaId)/complete"),
            method: "POST", body: UploadCompleteRequestPayload(capture: media.capture), timeout: 90
        )
    }

    func createRecord(text: String, mediaIds: [String], location: RecordLocation?, eventAt: Date) async throws -> Record {
        let created: CreatedRecordPayload = try await authenticatedRequest(
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
        let photos = mediaIds.map { RecordPhoto(id: $0) }
        return Record(id: created.id, text: text, eventAt: eventAt, location: location,
                      media: photos.isEmpty ? nil : RecordMedia(photos: photos, audio: nil), version: created.version)
    }

    private func authenticatedRequest<Response: Decodable, Body: Encodable>(
        url: URL,
        method: String,
        body: Body,
        timeout: TimeInterval = 60
    ) async throws -> Response {
        var request = URLRequest(url: url)
        request.timeoutInterval = timeout
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
            throw RecordWriteAPIError.api(decoded.errorMsg ?? "服务暂时不可用。", decoded.errorCode)
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
    let errorCode: String?
}

private struct UploadRequestPayload: Encodable {
    let mimeType: String
    let bytes: Int
}

struct UploadTicketPayload: Decodable {
    let mediaId: String
    let uploadUrl: String
    let expiresAt: String
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
    let version: Int
}

struct MediaUploadProgress {
    enum Stage { case ticket, uploading, uploaded, ready }
    let ticket: UploadTicketPayload
    var stage: Stage
}
