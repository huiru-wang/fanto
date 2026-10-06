import SwiftUI

struct RecordComposerLocationView: View {
    let location: RecordLocation?
    let state: RecordLocationCoordinator.State
    let edit: () -> Void
    let remove: () -> Void
    let retry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if let location {
                HStack(spacing: 0) {
                    Button(action: edit) {
                        HStack(spacing: 12) {
                            locationIcon("mappin", active: true)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(location.name)
                                    .font(.subheadline.weight(.medium))
                                    .foregroundStyle(.primary)
                                let administrativeText = RecordLocationFormatter.administrativeText(for: location)
                                if !administrativeText.isEmpty {
                                    Text(administrativeText)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            Image(systemName: "chevron.right")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.tertiary)
                        }
                        .padding(.vertical, 4)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint("搜索地点或在地图上重新选点")
                    Button("移除地点", systemImage: "xmark.circle.fill", action: remove)
                        .labelStyle(.iconOnly)
                        .font(.title3)
                        .foregroundStyle(.tertiary)
                        .frame(width: 44, height: 44)
                        .buttonStyle(.plain)
                }
            } else {
                HStack(spacing: 12) {
                    locationIcon(state == .denied ? "location.slash" : "mappin", active: false)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(title).font(.subheadline.weight(.medium))
                        if let detail {
                            Text(detail).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    Spacer(minLength: 0)
                    if state == .locating { ProgressView() }
                }
                if state == .idle {
                    Button("添加地点", systemImage: "plus", action: edit)
                        .font(.subheadline.weight(.medium))
                        .frame(minHeight: 44)
                } else {
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: 16) { locationActions }
                        VStack(alignment: .leading, spacing: 8) { locationActions }
                    }
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.quaternary.opacity(0.4), in: .rect(cornerRadius: 18))
    }

    private func locationIcon(_ name: String, active: Bool) -> some View {
        Image(systemName: name)
            .font(.body.weight(.medium))
            .foregroundStyle(active ? Color.accentColor : .secondary)
            .frame(width: 36, height: 36)
            .background(active ? Color.accentColor.opacity(0.1) : Color.secondary.opacity(0.08), in: Circle())
            .accessibilityHidden(true)
    }

    @ViewBuilder private var locationActions: some View {
        Button("手动添加地点", systemImage: "mappin.and.ellipse", action: edit)
            .buttonStyle(.borderedProminent)
            .font(.subheadline)
            .frame(minHeight: 44)
        if state == .denied {
            Button("去设置", systemImage: "arrow.up.right.square") {
                guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
                UIApplication.shared.open(url)
            }
            .font(.subheadline)
            .frame(minHeight: 44)
        } else if state == .unavailable {
            Button("重试定位", action: retry)
                .font(.subheadline)
                .frame(minHeight: 44)
        }
    }

    private var title: String {
        switch state {
        case .idle: "未添加地点"
        case .locating: "正在获取当前位置"
        case .unavailable: "未能获取当前位置"
        case .denied: "定位权限未开启"
        }
    }

    private var detail: String? {
        switch state {
        case .idle: nil
        case .locating: "可以继续记录，也可以手动选择地点"
        case .unavailable, .denied: "仍可搜索地点或在地图上选点"
        }
    }
}
