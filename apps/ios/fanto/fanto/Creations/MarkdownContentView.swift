import SwiftUI

struct MarkdownContentView: View {
    private let blocks: [MarkdownBlock]

    init(markdown: String, leadingTitleToOmit: String?) {
        blocks = MarkdownBlock.parse(markdown, omittingLeadingTitle: leadingTitleToOmit)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            ForEach(blocks) { block in
                switch block.kind {
                case let .heading(level, text):
                    Text(text)
                        .font(headingFont(for: level))
                        .fontWeight(.semibold)
                        .fixedSize(horizontal: false, vertical: true)
                case let .paragraph(text):
                    Text(markdownText(text))
                        .font(.body)
                        .fixedSize(horizontal: false, vertical: true)
                        .textSelection(.enabled)
                }
            }
        }
        .accessibilityElement(children: .contain)
    }

    private func headingFont(for level: Int) -> Font {
        switch level {
        case 1: .title2
        case 2: .title3
        default: .headline
        }
    }

    private func markdownText(_ text: String) -> AttributedString {
        (try? AttributedString(markdown: text)) ?? AttributedString(text)
    }
}

private struct MarkdownBlock: Identifiable {
    enum Kind {
        case heading(level: Int, text: String)
        case paragraph(String)
    }

    let id: String
    let kind: Kind

    static func parse(_ markdown: String, omittingLeadingTitle title: String?) -> [MarkdownBlock] {
        var blocks: [MarkdownBlock] = []
        var paragraph: [String] = []

        func appendParagraph() {
            guard !paragraph.isEmpty else { return }
            blocks.append(MarkdownBlock(id: "paragraph-\(blocks.count)", kind: .paragraph(paragraph.joined(separator: "\n"))))
            paragraph = []
        }

        for rawLine in markdown.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = String(rawLine)
            if line.trimmingCharacters(in: .whitespaces).isEmpty {
                appendParagraph()
                continue
            }

            let hashCount = line.prefix { $0 == "#" }.count
            let headingText = String(line.dropFirst(hashCount)).trimmingCharacters(in: .whitespaces)
            if (1 ... 6).contains(hashCount), !headingText.isEmpty, line.dropFirst(hashCount).first?.isWhitespace == true {
                appendParagraph()
                if blocks.isEmpty, let title, headingText == title {
                    continue
                }
                blocks.append(MarkdownBlock(id: "heading-\(blocks.count)", kind: .heading(level: hashCount, text: headingText)))
            } else {
                paragraph.append(line)
            }
        }
        appendParagraph()
        return blocks
    }
}
