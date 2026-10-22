import Foundation

struct MediaUploadAPIClient {
    static let shared = MediaUploadAPIClient()
    private let baseURL = URL(string: "https://fanto.robinverse.me")!
    private static let iso8601Formatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    func upload(_ media: DraftMediaUpload, purpose: String = "record", progress: MediaUploadProgress?, onProgress: (MediaUploadProgress) -> Void) async throws -> String {
        if media.mimeType.hasPrefix("image/") && media.data.count > (purpose == "user_cover" ? 2 * 1024 * 1024 : ["fanto_avatar", "user_avatar"].contains(purpose) ? 512 * 1024 : 10 * 1024 * 1024) {
            throw RecordWriteAPIError.server(purpose == "user_cover" ? "背景图不能超过 2MB" : ["fanto_avatar", "user_avatar"].contains(purpose) ? "头像不能超过 512KB" : "图片不能超过 10MB")
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
            let ticket: UploadTicketPayload
            do {
                ticket = try await authenticatedRequest(
                    url: baseURL.appending(path: "api/uploads"), method: "POST",
                    body: UploadRequestPayload(mimeType: media.mimeType, bytes: media.data.count, purpose: purpose)
                )
            } catch RecordWriteAPIError.api(let message, let code) where purpose == "user_cover" && code == "INVALID_INPUT" && message == "Unsupported media" {
                throw RecordWriteAPIError.api("背景图上传申请被服务端拒绝：上传参数未被接受。", code)
            }
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
        let token = try await AuthSession.shared.sessionToken()
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw RecordWriteAPIError.invalidResponse
        }

        let decoded = try JSONDecoder().decode(WriteAPIEnvelope<Response>.self, from: data)
        if http.statusCode == 401 { await AuthSession.shared.invalidate(); throw AuthenticationError.expired }
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
    let purpose: String
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

