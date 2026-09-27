import SwiftUI

struct AuthenticationProviderButton: View {
    let title: String
    var assetIcon: String?
    var systemIcon: String?
    var availability: String?
    var isEnabled = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                Text(title)
                    .font(.headline)
                    .frame(maxWidth: .infinity)

                HStack {
                    icon
                        .frame(width: 24, height: 24)
                    Spacer()
                }

                if let availability {
                    HStack {
                        Spacer()
                        Text(availability)
                            .font(.caption.weight(.medium))
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 9)
                            .padding(.vertical, 5)
                            .background(.primary.opacity(0.06), in: Capsule())
                    }
                }
            }
            .foregroundStyle(.primary)
            .padding(.horizontal, 22)
            .frame(maxWidth: 280, minHeight: 54)
            .background(.background.opacity(0.92), in: RoundedRectangle(cornerRadius: 27, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 27, style: .continuous)
                    .strokeBorder(.primary.opacity(isEnabled ? 0.24 : 0.14), lineWidth: 1)
            }
        }
        .buttonStyle(.plain)
        .contentShape(RoundedRectangle(cornerRadius: 27, style: .continuous))
        .disabled(!isEnabled)
        .opacity(isEnabled ? 1 : 0.72)
        .accessibilityLabel(title)
    }

    @ViewBuilder
    private var icon: some View {
        if let assetIcon {
            Image(assetIcon)
                .resizable()
                .scaledToFit()
        } else if let systemIcon {
            Image(systemName: systemIcon)
                .font(.title3.weight(.semibold))
        }
    }
}
