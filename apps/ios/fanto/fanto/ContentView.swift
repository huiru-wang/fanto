import SwiftUI

struct ContentView: View {
    var body: some View {
        TabView {
            RecordsScreen()
                .tabItem { Label("记录", systemImage: "square.stack.3d.up") }

            TopicsScreen()
                .tabItem { Label("回声", systemImage: "waveform") }
        }
        .tint(.indigo)
    }
}

private struct RecordsScreen: View {
    @StateObject private var model = RecordsModel()

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ScreenHeader(title: "记录", subtitle: "按时间收拢每一根线")
                    if model.isLoading && model.records.isEmpty {
                        ProgressView("正在读取记录…").frame(maxWidth: .infinity).padding(.top, 56)
                    } else if let error = model.errorMessage, model.records.isEmpty {
                        LoadFailure(message: error) { await model.load(reset: true) }
                    } else if model.records.isEmpty {
                        EmptyContent(title: "还没有记录", detail: "记录会在这里按时间出现。")
                    } else {
                        ForEach(Array(model.records.enumerated()), id: \.element.id) { index, record in
                            NavigationLink { RecordDetailScreen(recordID: record.id) } label: {
                                TimelineRecordRow(record: record, connectsDown: index < model.records.count - 1)
                            }
                            .buttonStyle(.plain)
                        }
                        LoadMoreButton(isLoading: model.isLoading, hasMore: model.hasMore) { await model.load() }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 28)
            }
            .background(Color(uiColor: .systemBackground))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(.hidden, for: .navigationBar)
            .refreshable { await model.load(reset: true) }
            .task { await model.load(reset: true) }
        }
    }
}

private struct TopicsScreen: View {
    @StateObject private var model = TopicsModel()

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 14) {
                    ScreenHeader(title: "回声", subtitle: "整理后留下的主题与脉络")
                    if model.isLoading && model.topics.isEmpty {
                        ProgressView("正在读取回声…").frame(maxWidth: .infinity).padding(.top, 56)
                    } else if let error = model.errorMessage, model.topics.isEmpty {
                        LoadFailure(message: error) { await model.load(reset: true) }
                    } else if model.topics.isEmpty {
                        EmptyContent(title: "还没有回声", detail: "整理完成后，主题会在这里出现。")
                    } else {
                        ForEach(model.topics) { topic in
                            NavigationLink { TopicDetailScreen(topicID: topic.id) } label: { TopicCard(topic: topic) }
                                .buttonStyle(.plain)
                        }
                        LoadMoreButton(isLoading: model.isLoading, hasMore: model.hasMore) { await model.load() }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 28)
            }
            .background(Color(uiColor: .systemBackground))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(.hidden, for: .navigationBar)
            .refreshable { await model.load(reset: true) }
            .task { await model.load(reset: true) }
        }
    }
}

private struct RecordDetailScreen: View {
    let recordID: String
    @StateObject private var model = RecordDetailModel()

    var body: some View {
        ScrollView {
            Group {
                if model.isLoading {
                    ProgressView().padding(.top, 56)
                } else if let record = model.record {
                    VStack(alignment: .leading, spacing: 18) {
                        Text(record.content).font(.body).foregroundStyle(.primary)
                        DetailMetadata(date: record.createdAt, status: record.status)
                        if !record.topics.isEmpty {
                            VStack(alignment: .leading, spacing: 10) {
                                Text("关联回声").font(.headline)
                                ForEach(record.topics) { topic in
                                    NavigationLink(topic.title) { TopicDetailScreen(topicID: topic.id) }.foregroundStyle(.indigo)
                                }
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                } else if let error = model.errorMessage {
                    LoadFailure(message: error) { await model.load(id: recordID) }
                }
            }
            .padding(20)
        }
        .navigationTitle("记录")
        .navigationBarTitleDisplayMode(.inline)
        .task { await model.load(id: recordID) }
    }
}

private struct TopicDetailScreen: View {
    let topicID: String
    @StateObject private var model = TopicDetailModel()
    @StateObject private var relatedRecords = TopicRecordsModel()

    var body: some View {
        ScrollView {
            Group {
                if model.isLoading {
                    ProgressView().padding(.top, 56)
                } else if let topic = model.topic {
                    VStack(alignment: .leading, spacing: 18) {
                        Text(topic.title).font(.title2.weight(.bold))
                        DetailMetadata(date: topic.updatedAt, status: topic.status, prefix: "更新于")
                        if !topic.tags.isEmpty { FlowTags(tags: topic.tags) }
                        if !topic.summary.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                            Text(topic.summary)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(14)
                                .background(Color.indigo.opacity(0.07), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        }
                        RelatedRecordsSection(model: relatedRecords, topicID: topicID)
                        MarkdownBody(markdown: topic.content)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                } else if let error = model.errorMessage {
                    LoadFailure(message: error) { await model.load(id: topicID) }
                }
            }
            .padding(20)
        }
        .navigationTitle("回声")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await model.load(id: topicID)
            await relatedRecords.load(topicID: topicID, reset: true)
        }
    }
}

private struct ScreenHeader: View {
    let title: String
    let subtitle: String
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.largeTitle.weight(.bold))
            Text(subtitle).font(.subheadline).foregroundStyle(.secondary)
        }
        .padding(.top, 20).padding(.bottom, 28)
    }
}

private struct TimelineRecordRow: View {
    let record: RecordDTO
    let connectsDown: Bool
    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(spacing: 0) {
                Circle().fill(.indigo).frame(width: 10, height: 10)
                if connectsDown { Rectangle().fill(Color.secondary.opacity(0.22)).frame(width: 1).frame(maxHeight: .infinity).padding(.top, 7) }
            }
            .frame(width: 10)
            VStack(alignment: .leading, spacing: 8) {
                Text(record.content).font(.body).foregroundStyle(.primary).lineLimit(2).multilineTextAlignment(.leading)
                DetailMetadata(date: record.createdAt, status: record.status)
                if let topic = record.topics.first { Text(topic.title).font(.footnote).foregroundStyle(.indigo).lineLimit(1) }
            }
            .padding(.bottom, 26)
            Spacer(minLength: 0)
        }
        .contentShape(Rectangle())
    }
}

private struct TopicCard: View {
    let topic: TopicDTO
    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            Text("更新于 \(DisplayDate.text(topic.updatedAt))").font(.caption).foregroundStyle(.secondary)
            HStack(alignment: .firstTextBaseline) {
                Text(topic.title).font(.headline).foregroundStyle(.primary)
                Spacer()
                Image(systemName: "arrow.up.right").foregroundStyle(.indigo)
            }
            Text(topic.summary).font(.subheadline).foregroundStyle(.secondary).lineLimit(3).multilineTextAlignment(.leading)
            if !topic.tags.isEmpty { Text(topic.tags.prefix(4).map { "#\($0)" }.joined(separator: "  ")).font(.caption).foregroundStyle(.indigo).lineLimit(1) }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

private struct DetailMetadata: View {
    let date: String
    let status: String
    var prefix = "记录于"
    var body: some View {
        HStack(spacing: 8) {
            Text("\(prefix) \(DisplayDate.text(date))")
            Text(statusText)
                .foregroundStyle(statusAppearance.foreground)
                .padding(.horizontal, 7)
                .padding(.vertical, 3)
                .background(statusAppearance.background, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .stroke(statusAppearance.border, lineWidth: 1)
                }
        }
        .font(.caption).foregroundStyle(.secondary)
    }
    private var statusText: String {
        switch status {
        case "pending", "updated": "待整理"
        case "processing": "整理中"
        case "organized": "已整理"
        case "skipped": "已略过"
        default: status
        }
    }

    private var statusAppearance: (foreground: Color, background: Color, border: Color) {
        switch status {
        case "organized":
            (.green.opacity(0.9), .green.opacity(0.12), .green.opacity(0.2))
        case "pending", "updated":
            (.orange.opacity(0.9), .orange.opacity(0.13), .orange.opacity(0.24))
        case "processing":
            (.indigo.opacity(0.9), .indigo.opacity(0.12), .indigo.opacity(0.2))
        default:
            (.secondary, Color.secondary.opacity(0.1), Color.secondary.opacity(0.16))
        }
    }
}

private struct FlowTags: View {
    let tags: [String]
    var body: some View { Text(tags.map { "#\($0)" }.joined(separator: "  ")).font(.footnote.weight(.medium)).foregroundStyle(.indigo) }
}

private struct MarkdownBody: View {
    let markdown: String

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            ForEach(Array(MarkdownParser.parse(markdown).enumerated()), id: \.offset) { _, block in
                MarkdownBlockView(block: block)
            }
        }
    }
}

private struct RelatedRecordsSection: View {
    @ObservedObject var model: TopicRecordsModel
    let topicID: String
    @State private var isExpanded = true

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                isExpanded.toggle()
            } label: {
                HStack {
                    Text("相关原始记录").font(.headline)
                    Spacer()
                    Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                        .font(.footnote.weight(.semibold))
                }
                .foregroundStyle(.secondary)
                .padding(.vertical, 8)
            }
            .buttonStyle(.plain)

            if isExpanded {
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        if model.isLoading && model.records.isEmpty {
                            ProgressView().frame(maxWidth: .infinity).padding(.vertical, 42)
                        } else if let error = model.errorMessage, model.records.isEmpty {
                            VStack(spacing: 8) {
                                Text(error).font(.footnote).foregroundStyle(.secondary)
                                Button("重新尝试") { Task { await model.load(topicID: topicID, reset: true) } }
                                    .font(.footnote.weight(.medium))
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 32)
                        } else if model.records.isEmpty {
                            Text("暂无关联记录").font(.footnote).foregroundStyle(.secondary).padding(.vertical, 18)
                        } else {
                    ForEach(model.records) { record in
                        NavigationLink { RecordDetailScreen(recordID: record.id) } label: {
                            VStack(alignment: .leading, spacing: 6) {
                                Text(DisplayDate.text(record.createdAt)).font(.caption).foregroundStyle(.secondary)
                                Text(record.content).font(.subheadline).foregroundStyle(.primary).lineLimit(2).multilineTextAlignment(.leading)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.leading, 14)
                            .padding(.vertical, 11)
                            .overlay(alignment: .leading) { Rectangle().fill(Color.secondary.opacity(0.24)).frame(width: 2) }
                        }
                        .buttonStyle(.plain)
                    }
                            if model.hasMore {
                                Button(model.isLoading ? "加载中…" : "加载更多") { Task { await model.load(topicID: topicID) } }
                                    .disabled(model.isLoading)
                                    .font(.footnote.weight(.medium))
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 12)
                            }
                        }
                    }
                }
                .frame(height: 170)
                .scrollIndicators(.visible)
            }
        }
    }
}

private enum MarkdownBlock {
    case heading(level: Int, text: String)
    case paragraph(String)
    case unorderedList([String])
    case orderedList([String])
    case quote(String)
    case code(String)
    case divider
}

private enum MarkdownParser {
    static func parse(_ markdown: String) -> [MarkdownBlock] {
        let lines = markdown.components(separatedBy: .newlines)
        var blocks: [MarkdownBlock] = []
        var index = 0

        while index < lines.count {
            let line = lines[index]
            if line.trimmingCharacters(in: .whitespaces).isEmpty { index += 1; continue }

            if line.hasPrefix("```") {
                index += 1
                var codeLines: [String] = []
                while index < lines.count, !lines[index].hasPrefix("```") {
                    codeLines.append(lines[index]); index += 1
                }
                if index < lines.count { index += 1 }
                blocks.append(.code(codeLines.joined(separator: "\n")))
            } else if let heading = heading(line) {
                blocks.append(.heading(level: heading.level, text: heading.text)); index += 1
            } else if isDivider(line) {
                blocks.append(.divider); index += 1
            } else if line.hasPrefix(">") {
                var quoteLines: [String] = []
                while index < lines.count, lines[index].hasPrefix(">") {
                    quoteLines.append(String(lines[index].dropFirst()).trimmingCharacters(in: .whitespaces)); index += 1
                }
                blocks.append(.quote(quoteLines.joined(separator: "\n")))
            } else if let item = unorderedItem(line) {
                var items = [item]; index += 1
                while index < lines.count, let next = unorderedItem(lines[index]) { items.append(next); index += 1 }
                blocks.append(.unorderedList(items))
            } else if let item = orderedItem(line) {
                var items = [item]; index += 1
                while index < lines.count, let next = orderedItem(lines[index]) { items.append(next); index += 1 }
                blocks.append(.orderedList(items))
            } else {
                var paragraph = [line]; index += 1
                while index < lines.count, !lines[index].trimmingCharacters(in: .whitespaces).isEmpty, !startsBlock(lines[index]) {
                    paragraph.append(lines[index]); index += 1
                }
                blocks.append(.paragraph(paragraph.joined(separator: "\n")))
            }
        }
        return blocks
    }

    private static func heading(_ line: String) -> (level: Int, text: String)? {
        let characters = Array(line)
        let level = characters.prefix { $0 == "#" }.count
        guard (1...6).contains(level), characters.count > level, characters[level] == " " else { return nil }
        return (level, String(characters.dropFirst(level + 1)))
    }

    private static func unorderedItem(_ line: String) -> String? {
        for marker in ["- ", "* ", "+ "] where line.hasPrefix(marker) { return String(line.dropFirst(2)) }
        return nil
    }

    private static func orderedItem(_ line: String) -> String? {
        let characters = Array(line)
        var index = 0
        while index < characters.count, characters[index].isNumber { index += 1 }
        guard index > 0, index + 1 < characters.count, characters[index] == ".", characters[index + 1] == " " else { return nil }
        return String(characters.dropFirst(index + 2))
    }

    private static func isDivider(_ line: String) -> Bool {
        ["---", "***", "___"].contains(line.filter { !$0.isWhitespace })
    }

    private static func startsBlock(_ line: String) -> Bool {
        line.hasPrefix("```") || line.hasPrefix(">") || heading(line) != nil || unorderedItem(line) != nil || orderedItem(line) != nil || isDivider(line)
    }
}

private struct MarkdownBlockView: View {
    let block: MarkdownBlock

    var body: some View {
        switch block {
        case let .heading(level, text):
            inline(text).font(headingFont(level)).foregroundStyle(.primary).padding(.top, level == 1 ? 4 : 0)
        case let .paragraph(text):
            inline(text).font(.body).foregroundStyle(.primary)
        case let .unorderedList(items):
            VStack(alignment: .leading, spacing: 7) {
                ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                    HStack(alignment: .top, spacing: 9) {
                        Circle().fill(Color.secondary).frame(width: 5, height: 5).padding(.top, 8)
                        inline(item).font(.body).foregroundStyle(.primary)
                    }
                }
            }
        case let .orderedList(items):
            VStack(alignment: .leading, spacing: 7) {
                ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                    HStack(alignment: .top, spacing: 8) {
                        Text("\(index + 1). ").font(.body).foregroundStyle(.secondary)
                        inline(item).font(.body).foregroundStyle(.primary)
                    }
                }
            }
        case let .quote(text):
            inline(text).font(.body).foregroundStyle(.secondary)
                .padding(.leading, 14)
                .overlay(alignment: .leading) { Rectangle().fill(Color.indigo.opacity(0.45)).frame(width: 3) }
        case let .code(text):
            ScrollView(.horizontal, showsIndicators: false) {
                Text(text).font(.system(.footnote, design: .monospaced)).foregroundStyle(.primary).padding(12)
            }
            .background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        case .divider:
            Divider().padding(.vertical, 4)
        }
    }

    private func inline(_ text: String) -> Text {
        guard let value = try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)) else { return Text(text) }
        return Text(value)
    }

    private func headingFont(_ level: Int) -> Font {
        switch level {
        case 1: .title2.weight(.bold)
        case 2: .title3.weight(.bold)
        default: .headline
        }
    }
}

private struct LoadMoreButton: View {
    let isLoading: Bool
    let hasMore: Bool
    let action: () async -> Void
    var body: some View {
        if hasMore {
            Button(isLoading ? "加载中…" : "加载更多") { Task { await action() } }
                .disabled(isLoading).frame(maxWidth: .infinity).padding(.vertical, 18)
        }
    }
}

private struct LoadFailure: View {
    let message: String
    let retry: () async -> Void
    var body: some View {
        VStack(spacing: 12) {
            Text(message).font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
            Button("重新尝试") { Task { await retry() } }.buttonStyle(.bordered)
        }
        .frame(maxWidth: .infinity).padding(.top, 56)
    }
}

private struct EmptyContent: View {
    let title: String
    let detail: String
    var body: some View {
        VStack(spacing: 8) {
            Text(title).font(.headline)
            Text(detail).font(.subheadline).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity).padding(.top, 56)
    }
}
