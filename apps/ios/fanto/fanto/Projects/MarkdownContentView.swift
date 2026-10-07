import SwiftUI
import Markdown

struct MarkdownContentView: View {
    private let blocks: [MarkdownBlock]
    private let allowsHTMLPreview: Bool
    init(markdown: String, leadingTitleToOmit: String?, allowsHTMLPreview: Bool = false) {
        blocks = MarkdownBlock.parse(markdown, omittingLeadingTitle: leadingTitleToOmit)
        self.allowsHTMLPreview = allowsHTMLPreview
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            ForEach(blocks) { block in
                switch block.kind {
                case let .heading(level, text):
                    Text(inline(text)).font(level == 1 ? .title2 : level == 2 ? .title3 : .headline)
                        .fontWeight(.semibold).fixedSize(horizontal: false, vertical: true)
                        .accessibilityAddTraits(.isHeader)
                case let .paragraph(text):
                    Text(inline(text)).fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
                case let .code(language, text):
                    if language == "html-preview", allowsHTMLPreview {
                        ProjectHTMLPreview(html: text)
                    } else {
                        ScrollView(.horizontal) { Text(text).font(.system(.callout, design: .monospaced)).textSelection(.enabled).padding(12) }
                            .background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
                    }
                case let .images(images):
                    ProjectImageGallery(images: images)
                case let .table(rows):
                    ScrollView(.horizontal) {
                        Grid(alignment: .leading, horizontalSpacing: 20, verticalSpacing: 12) {
                            ForEach(rows.indices, id: \.self) { row in
                                GridRow {
                                    ForEach(rows[row].indices, id: \.self) { col in
                                        Text(inline(rows[row][col])).fontWeight(row == 0 ? .semibold : .regular)
                                    }
                                }
                            }
                        }.padding(12)
                    }.background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
                case .divider: Divider()
                }
            }
        }.accessibilityElement(children: .contain)
            .environment(\.openURL, OpenURLAction { url in
                ["https", "http"].contains(url.scheme?.lowercased() ?? "") ? .systemAction : .discarded
            })
    }
    private func inline(_ text: String) -> AttributedString {
        (try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(text)
    }
}

struct ProjectMarkdownImage: Identifiable {
    let id: String
    let mediaID: String
    let caption: String
}
private struct MarkdownBlock: Identifiable {
    enum Kind {
        case heading(Int, String), paragraph(String), code(String?, String), images([ProjectMarkdownImage]), table([[String]]), divider
    }
    let id: Int
    var kind: Kind
    static func parse(_ markdown: String, omittingLeadingTitle title: String?) -> [MarkdownBlock] {
        var blocks: [MarkdownBlock] = []
        var imageIndex = 0
        func append(_ kind: Kind) { blocks.append(.init(id: blocks.count, kind: kind)) }
        func image(_ node: Markdown.Image) -> ProjectMarkdownImage? {
            guard let source = node.source, source.hasPrefix("fanto-media://") else { return nil }
            let mediaID = String(source.dropFirst("fanto-media://".count))
            guard UUID(uuidString: mediaID) != nil else { return nil }
            imageIndex += 1
            return .init(id: "image-\(imageIndex)", mediaID: mediaID, caption: node.plainText)
        }
        func images(_ nodes: [ProjectMarkdownImage]) {
            if let last = blocks.last, case let .images(previous) = last.kind {
                blocks[blocks.count - 1].kind = .images(previous + nodes)
            } else { append(.images(nodes)) }
        }
        func visit(_ node: any Markup, prefix: String = "") {
            if let heading = node as? Heading {
                if blocks.isEmpty, let title, heading.plainText == title { return }
                append(.heading(heading.level, heading.format().dropFirst(heading.level + 1).description))
            } else if let paragraph = node as? Paragraph {
                var text = prefix
                for child in paragraph.children {
                    if let item = child as? Markdown.Image, let item = image(item) {
                        if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { append(.paragraph(text)); text = "" }
                        images([item])
                    } else { text += child.format() }
                }
                if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { append(.paragraph(text)) }
            } else if let code = node as? CodeBlock { append(.code(code.language, code.code))
            } else if let table = node as? Markdown.Table {
                var rows = [table.head.children.map { cell in cell.children.map { $0.format() }.joined() }]
                rows += table.body.children.map { row in row.children.map { cell in cell.children.map { $0.format() }.joined() } }
                append(.table(rows))
            } else if node is ThematicBreak { append(.divider)
            } else if let list = node as? OrderedList {
                for (offset, item) in list.children.enumerated() {
                    for (index, child) in item.children.enumerated() { visit(child, prefix: index == 0 ? "\(Int(list.startIndex) + offset). " : "  ") }
                }
            } else if let list = node as? UnorderedList {
                for item in list.children { for (index, child) in item.children.enumerated() { visit(child, prefix: index == 0 ? "• " : "  ") } }
            } else if node is BlockQuote {
                for child in node.children { visit(child, prefix: "▎ ") }
            } else if node is HTMLBlock { append(.paragraph(node.format()))
            } else { for child in node.children { visit(child) } }
        }
        visit(Document(parsing: markdown))
        return blocks
    }
}

private struct ProjectImageGallery: View {
    let images: [ProjectMarkdownImage]
    @State private var selection: ProjectMarkdownImage?
    var body: some View {
        LazyVGrid(columns: images.count == 1 ? [GridItem(.flexible())] : [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
            ForEach(Array(images.enumerated()), id: \.offset) { index, item in
                Button { selection = item } label: {
                    VStack(alignment: .leading, spacing: 6) {
                        ProjectMediaImage(mediaID: item.mediaID, variant: .thumbnail).aspectRatio(images.count == 1 ? 4 / 3 : 1, contentMode: .fit)
                        if !item.caption.isEmpty { Text(item.caption).font(.caption).foregroundStyle(.secondary).lineLimit(3) }
                    }
                }.buttonStyle(.plain).accessibilityLabel(item.caption.isEmpty ? "查看第 \(index + 1) 张图片" : item.caption)
            }
        }
        .fullScreenCover(item: $selection) { selected in
            ProjectImageViewer(images: images, initialID: selected.id)
        }
    }
}
private struct ProjectImageViewer: View {
    let images: [ProjectMarkdownImage]
    @Environment(\.dismiss) private var dismiss
    @State private var selectedID: String
    init(images: [ProjectMarkdownImage], initialID: String) { self.images = images; _selectedID = State(initialValue: initialID) }
    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            TabView(selection: $selectedID) {
                ForEach(Array(images.enumerated()), id: \.offset) { _, item in
                    ProjectMediaImage(mediaID: item.mediaID, variant: .original).tag(item.id)
                }
            }.tabViewStyle(.page)
        }.safeAreaInset(edge: .top) {
            HStack { Button("关闭", systemImage: "xmark", action: dismiss.callAsFunction); Spacer() }.padding().tint(.white)
        }
    }
}
struct ProjectMediaImage: View {
    let mediaID: String
    let variant: MediaReadVariant
    @State private var url: URL?
    @State private var retried = false
    @State private var failure: String?
    var body: some View {
        Group {
            if let failure {
                VStack { Image(systemName: "photo"); Text(failure).font(.caption); Button("重试") { Task { await load() } } }
            } else if let url {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case let .success(image): image.resizable().scaledToFit()
                    case .failure:
                        ProgressView().task {
                            if !retried { retried = true; await load() }
                            else { failure = "图片暂时无法显示" }
                        }
                    default: ProgressView()
                    }
                }
            } else { ProgressView() }
        }.frame(maxWidth: .infinity).task(id: mediaID) { await load() }
    }
    private func load() async {
        url = nil; failure = nil
        do { url = try await FantoAPIClient.shared.fetchMediaReadURL(id: mediaID, variant: variant) }
        catch { failure = "图片暂时无法显示" }
    }
}
