import SwiftUI
import ImageIO

/// Images are identified by media ID, never by the changing signed URL.
@MainActor
final class MediaImageCache {
    static let shared = MediaImageCache()
    private let images = NSCache<NSString, UIImage>()
    private var tasks: [String: Task<UIImage, Error>] = [:]
    private var locations: [String: MediaReadLocation] = [:]
    private var locationTasks: [String: Task<MediaReadLocation, Error>] = [:]
    private let session: URLSession

    init() {
        images.totalCostLimit = 32 * 1024 * 1024
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        session = URLSession(configuration: configuration)
    }

    func reset() {
        tasks.values.forEach { $0.cancel() }; tasks.removeAll()
        locationTasks.values.forEach { $0.cancel() }; locationTasks.removeAll()
        locations.removeAll(); images.removeAllObjects()
    }

    func cached(id: String, variant: MediaReadVariant) -> UIImage? {
        guard AccountCache.shared.scope != nil else { return nil }
        return images.object(forKey: key(id, variant) as NSString)
    }

    func restore(id: String, variant: MediaReadVariant) async {
        guard let scope = AccountCache.shared.scope, cached(id: id, variant: variant) == nil,
              let data = await AccountCacheDisk.shared.read(key(id, variant), scope: scope, image: true),
              let image = try? await Self.decode(data, variant: variant), AccountCache.shared.scope == scope else { return }
        remember(image, key: key(id, variant))
    }

    func readURL(id: String, variant: MediaReadVariant, renew: Bool = false) async throws -> URL {
        guard let scope = AccountCache.shared.scope else { throw CancellationError() }
        let key = key(id, variant)
        if !renew, let location = locations[key], location.expiresAt > .now.addingTimeInterval(30) { return location.url }
        if let task = locationTasks[key] {
            let location = try await task.value
            try check(scope)
            return location.url
        }
        let task = Task { try await FantoAPIClient.shared.fetchMediaReadLocation(id: id, variant: variant) }
        locationTasks[key] = task
        defer { if AccountCache.shared.scope == scope { locationTasks[key] = nil } }
        let location = try await task.value
        guard AccountCache.shared.scope == scope else { throw CancellationError() }
        locations[key] = location
        return location.url
    }

    func image(id: String, variant: MediaReadVariant) async throws -> UIImage {
        guard let scope = AccountCache.shared.scope else { throw CancellationError() }
        if let image = cached(id: id, variant: variant) { return image }
        let key = key(id, variant)
        if let task = tasks[key] {
            let image = try await task.value
            try check(scope)
            return image
        }
        let task = Task<UIImage, Error> {
            if let data = await AccountCacheDisk.shared.read(key, scope: scope, image: true) {
                if let image = try? await Self.decode(data, variant: variant) {
                    try self.check(scope); self.remember(image, key: key); return image
                }
                await AccountCacheDisk.shared.remove(key, scope: scope, image: true)
            }
            for attempt in 0...1 {
                do {
                    try self.check(scope)
                    let url = try await self.readURL(id: id, variant: variant, renew: attempt > 0)
                    let (data, response) = try await self.session.data(from: url)
                    guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
                        throw FantoAPIError.invalidResponse
                    }
                    let image = try await Self.decode(data, variant: variant)
                    try self.check(scope)
                    await AccountCacheDisk.shared.write(data, key: key, scope: scope, image: true)
                    try self.check(scope); self.remember(image, key: key)
                    return image
                } catch {
                    try self.check(scope)
                    if attempt == 1 { throw error }
                }
            }
            throw FantoAPIError.invalidResponse
        }
        tasks[key] = task
        defer { if AccountCache.shared.scope == scope { tasks[key] = nil } }
        return try await task.value
    }

    /// Uploads of avatars/covers use one object for both variants. Record thumbnails are server generated.
    func seed(_ data: Data, id: String, variants: [MediaReadVariant], scope: AccountCacheScope) async {
        for variant in variants {
            guard AccountCache.shared.scope == scope, let image = try? await Self.decode(data, variant: variant) else { return }
            guard AccountCache.shared.scope == scope else { return }
            let key = key(id, variant)
            remember(image, key: key)
            await AccountCacheDisk.shared.write(data, key: key, scope: scope, image: true)
        }
    }

    private func key(_ id: String, _ variant: MediaReadVariant) -> String { "\(id)/\(variant.rawValue)" }
    private func check(_ scope: AccountCacheScope) throws {
        try Task.checkCancellation()
        guard AccountCache.shared.scope == scope else { throw CancellationError() }
    }
    private func remember(_ image: UIImage, key: String) {
        let bytes = image.cgImage.map { $0.bytesPerRow * $0.height } ?? 0
        images.setObject(image, forKey: key as NSString, cost: bytes)
    }

    @concurrent private static func decode(_ data: Data, variant: MediaReadVariant) async throws -> UIImage {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceShouldCacheImmediately: true,
                kCGImageSourceThumbnailMaxPixelSize: variant == .thumbnail ? 512 : 2560
              ] as CFDictionary) else { throw FantoAPIError.invalidResponse }
        return UIImage(cgImage: image)
    }
}

struct CachedMediaImage<Content: View>: View {
    let mediaID: String
    var variant: MediaReadVariant = .original
    @ViewBuilder let content: (AsyncImagePhase) -> Content
    @State private var loadedImage: UIImage?
    @State private var loadedKey: String?
    @State private var failed = false
    private var key: String { "\(AccountCache.shared.scope?.sessionID.uuidString ?? "signed-out")/\(mediaID)/\(variant.rawValue)" }

    var body: some View {
        content(phase)
            .task(id: key) {
                let requested = key
                failed = false
                do {
                    let image = try await MediaImageCache.shared.image(id: mediaID, variant: variant)
                    try Task.checkCancellation()
                    guard requested == key else { return }
                    loadedImage = image; loadedKey = requested
                } catch { if !Task.isCancelled, requested == key { failed = true } }
            }
    }
    private var phase: AsyncImagePhase {
        if let image = MediaImageCache.shared.cached(id: mediaID, variant: variant) ?? (loadedKey == key ? loadedImage : nil) {
            return .success(Image(uiImage: image))
        }
        return failed ? .failure(FantoAPIError.invalidResponse) : .empty
    }
}
