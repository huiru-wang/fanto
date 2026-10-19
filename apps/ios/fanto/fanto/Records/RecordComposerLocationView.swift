import MapKit
import SwiftUI

struct RecordComposerLocationView: View {
    let location: RecordLocation?
    let state: RecordLocationCoordinator.State
    let edit: () -> Void
    let remove: () -> Void

    var body: some View {
        if let location {
            let coordinate = CLLocationCoordinate2D(latitude: location.latitude, longitude: location.longitude)
            Map(position: .constant(.region(MKCoordinateRegion(center: coordinate,
                span: MKCoordinateSpan(latitudeDelta: 0.012, longitudeDelta: 0.012)))), interactionModes: []) {
                Marker(location.name, systemImage: "mappin", coordinate: coordinate).tint(FantoTheme.accent)
            }
            .mapStyle(.standard(elevation: .flat, pointsOfInterest: .excludingAll))
            .frame(height: 260)
            .clipShape(.rect(cornerRadius: 20))
            .accessibilityLabel("\(location.name)，地图预览")
            .overlay(alignment: .bottomTrailing) {
                Button(action: edit) {
                    HStack(spacing: 10) {
                        Image(systemName: "mappin.circle.fill").font(.title2).foregroundStyle(FantoTheme.accent)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(location.name).font(.subheadline.weight(.semibold)).lineLimit(2)
                            let administrativeText = RecordLocationFormatter.detailText(for: location)
                            if !administrativeText.isEmpty {
                                Text(administrativeText).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                            }
                        }
                    }
                    .padding(.horizontal, 10).padding(.vertical, 8)
                    .frame(minHeight: 44)
                }
                .buttonStyle(.glass)
                .buttonBorderShape(.roundedRectangle(radius: 16))
                .accessibilityHint("搜索地点或在地图上重新选点")
                .padding(.leading, 90).padding([.trailing, .bottom], 12)
            }
            .overlay(alignment: .topTrailing) {
                Menu {
                    Button("修改地点", systemImage: "magnifyingglass", action: edit)
                    Button("移除地点", systemImage: "trash", role: .destructive, action: remove)
                } label: {
                    Image(systemName: "ellipsis").frame(width: 44, height: 44)
                }
                .buttonStyle(.glass).buttonBorderShape(.circle)
                .accessibilityLabel("地点选项")
                .padding(10)
            }
        } else {
            Button(action: edit) {
                HStack(spacing: 12) {
                    Image(systemName: "mappin").foregroundStyle(.secondary)
                    Text("添加地点").font(.subheadline.weight(.medium)).foregroundStyle(.primary)
                    Spacer()
                    if state == .locating { ProgressView().accessibilityLabel("正在获取当前位置") }
                    Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
                }
                .padding(.horizontal, 16).frame(minHeight: 56)
                .background(.quaternary.opacity(0.4), in: .rect(cornerRadius: 16))
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityHint("搜索地点或在地图上选点")
        }
    }
}
