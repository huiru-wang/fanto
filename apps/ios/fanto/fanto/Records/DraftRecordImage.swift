import ImageIO
import UIKit

struct DraftRecordImage: Identifiable {
    let id: UUID
    let data: Data
    let preview: UIImage
    let width: Int
    let height: Int
    var mediaID: String?
    var uploadProgress: MediaUploadProgress?

    init(data originalData: Data) throws {
        id = UUID()
        guard let source = CGImageSourceCreateWithData(originalData as CFData, nil),
              let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: 2400,
              ] as CFDictionary),
              let jpeg = UIImage(cgImage: image).jpegData(compressionQuality: 0.9) else {
            throw RecordWriteAPIError.server("图片读取失败，请重新选择。")
        }
        guard jpeg.count <= 10 * 1024 * 1024 else { throw RecordWriteAPIError.server("图片不能超过 10MB") }
        data = jpeg
        width = image.width
        height = image.height
        preview = UIImage(cgImage: CGImageSourceCreateThumbnailAtIndex(source, 0, [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: 320,
        ] as CFDictionary) ?? image)
    }
    init(restoring photo: RecordDraftPhoto) throws {
        guard let source = CGImageSourceCreateWithData(photo.data as CFData, nil),
              let thumbnail = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: 320,
              ] as CFDictionary) else { throw CocoaError(.fileReadCorruptFile) }
        id = photo.id; data = photo.data; width = photo.width; height = photo.height
        preview = UIImage(cgImage: thumbnail); mediaID = photo.mediaID
    }

}
