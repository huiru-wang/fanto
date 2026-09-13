import SwiftUI

struct RecordMediaView: View {
    let media: RecordMedia

    var body: some View {
        switch media {
        case let .photos(count):
            HStack(spacing: 8) {
                ForEach(0..<min(count, 3), id: \.self) { index in
                    RoundedRectangle(cornerRadius: 10)
                        .fill(index == 0 ? FantoTheme.softAccent : Color.secondary.opacity(0.18))
                        .frame(width: 66, height: 52)
                        .overlay {
                            Image(systemName: index == 0 ? "photo" : "photo.fill")
                                .foregroundStyle(index == 0 ? FantoTheme.accent : .secondary)
                        }
                        .overlay {
                            RoundedRectangle(cornerRadius: 10)
                                .stroke(.background, lineWidth: 2)
                        }
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(count) 张图片")

        case let .audio(duration):
            Button {
                // Playback will be connected to the persisted audio asset in the media integration.
            } label: {
                Label(Duration.seconds(duration).formatted(.time(pattern: .minuteSecond)), systemImage: "play.fill")
            }
                .buttonStyle(.bordered)
                .tint(FantoTheme.accent)
                .accessibilityLabel("播放录音")
                .accessibilityValue("时长 \(Duration.seconds(duration).formatted(.time(pattern: .minuteSecond)))")
        }
    }
}
