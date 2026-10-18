import Foundation
import ImageIO
import CoreGraphics
import UniformTypeIdentifiers

nonisolated struct AvatarSource: Identifiable, Sendable {
    let id = UUID()
    let image: CGImage
}

nonisolated enum AvatarImageProcessor {
    @concurrent static func prepare(_ data: Data) async throws -> AvatarSource {
        guard data.count <= 20 * 1024 * 1024,
              let source = CGImageSourceCreateWithData(data as CFData, nil), CGImageSourceGetCount(source) == 1,
              let info = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = info[kCGImagePropertyPixelWidth] as? Int, let height = info[kCGImagePropertyPixelHeight] as? Int,
              width * height <= 40_000_000, min(width, height) >= 128,
              let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: 4096,
              ] as CFDictionary) else { throw failure("无法读取图片，请选择至少 128 像素、20MB 以内的静态图片。") }
        guard min(image.width, image.height) >= 128 else { throw failure("图片过于狭长，请选择更接近方形的图片。") }
        return AvatarSource(image: image)
    }

    @concurrent static func export(_ image: CGImage, side: CGFloat, offset: CGSize, zoom: CGFloat) async throws -> (Data, Int) {
        let width = CGFloat(image.width), height = CGFloat(image.height)
        let scale = max(side / width, side / height) * zoom
        let length = min(width, height, side / scale)
        let x = max(0, min(width - length, width / 2 - (side / 2 + offset.width) / scale))
        let y = max(0, min(height - length, height / 2 - (side / 2 + offset.height) / scale))
        let rect = CGRect(x: floor(x), y: floor(y), width: floor(length), height: floor(length))
        let outputSide = min(512, Int(floor(length)))
        guard outputSide >= 128, let crop = image.cropping(to: rect),
              let colorSpace = CGColorSpace(name: CGColorSpace.sRGB),
              let context = CGContext(data: nil, width: outputSide, height: outputSide, bitsPerComponent: 8, bytesPerRow: 0, space: colorSpace, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { throw failure("无法裁剪头像，请调整范围。") }
        context.setFillColor(CGColor(gray: 1, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: outputSide, height: outputSide))
        context.interpolationQuality = .high
        context.draw(crop, in: CGRect(x: 0, y: 0, width: outputSide, height: outputSide))
        guard let final = context.makeImage() else { throw failure("头像生成失败。") }
        for quality in [0.85, 0.7, 0.55] {
            let data = NSMutableData()
            guard let destination = CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil) else { continue }
            CGImageDestinationAddImage(destination, final, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
            if CGImageDestinationFinalize(destination), data.length <= 512 * 1024 { return (data as Data, outputSide) }
        }
        throw failure("头像生成失败，请更换图片。")
    }
    private static func failure(_ message: String) -> NSError { NSError(domain: "FantoAvatar", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
}
