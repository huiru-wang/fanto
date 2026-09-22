import Foundation

struct LegacyConversationMedia {
    let markdown: String
    let items: [PresentedMedia]

    static func extract(from markdown: String) -> Self {
        var remaining = markdown
        var items: [PresentedMedia] = []

        extractMatches(
            pattern: #"!\[[^\]]*\]\((fanto-media://[^\s)]+)[^)]*\)"#,
            type: .image,
            from: &remaining,
            into: &items
        )
        extractMatches(
            pattern: #"(?<!!)\[[^\]]*\]\((fanto-media://[^\s)]+)[^)]*\)"#,
            type: .audio,
            from: &remaining,
            into: &items
        )

        return Self(
            markdown: remaining.trimmingCharacters(in: .whitespacesAndNewlines),
            items: mergePresentedMedia([], items)
        )
    }

    private static func extractMatches(
        pattern: String,
        type: PresentedMediaType,
        from markdown: inout String,
        into items: inout [PresentedMedia]
    ) {
        guard let expression = try? NSRegularExpression(pattern: pattern) else { return }
        let range = NSRange(markdown.startIndex..., in: markdown)
        let matches = expression.matches(in: markdown, range: range)
        var extracted: [PresentedMedia] = []

        for match in matches.reversed() {
            guard let urlRange = Range(match.range(at: 1), in: markdown),
                  let fullRange = Range(match.range, in: markdown),
                  let mediaID = mediaID(from: String(markdown[urlRange]))
            else { continue }

            extracted.append(PresentedMedia(
                mediaID: mediaID,
                mediaType: type,
                mimeType: type == .image ? "image/*" : "audio/*",
                width: nil,
                height: nil,
                durationMS: nil
            ))
            markdown.replaceSubrange(fullRange, with: "")
        }

        items.append(contentsOf: extracted.reversed())
    }

    private static func mediaID(from url: String) -> String? {
        guard url.hasPrefix("fanto-media://") else { return nil }
        let rawID = url.dropFirst("fanto-media://".count)
            .drop { $0 == "/" }
            .split(whereSeparator: { $0 == "/" || $0 == "?" || $0 == "#" })
            .first?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return rawID?.isEmpty == false ? String(rawID!) : nil
    }
}
