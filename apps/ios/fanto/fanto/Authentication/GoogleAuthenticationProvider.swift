import Foundation
import GoogleSignIn
import UIKit

enum GoogleAuthenticationProvider {
    static func idToken(nonce: String) async throws -> String {
        guard let clientID = Bundle.main.object(forInfoDictionaryKey: "GIDClientID") as? String,
              !clientID.isEmpty, !clientID.hasPrefix("$("), !clientID.hasPrefix("REPLACE_") else {
            throw AuthenticationError.configuration("Google 登录尚未配置 iOS Client ID。")
        }
        guard let serverClientID = Bundle.main.object(forInfoDictionaryKey: "GIDServerClientID") as? String,
              !serverClientID.isEmpty, !serverClientID.hasPrefix("$("), !serverClientID.hasPrefix("REPLACE_") else {
            throw AuthenticationError.configuration("Google 登录尚未配置 Server Client ID。")
        }
        guard let presenter = UIApplication.shared.fantoTopViewController else {
            throw AuthenticationError.configuration("暂时无法打开 Google 登录。")
        }

        GIDSignIn.sharedInstance.configuration = GIDConfiguration(clientID: clientID, serverClientID: serverClientID)

        return try await withCheckedThrowingContinuation { continuation in
            GIDSignIn.sharedInstance.signIn(
                withPresenting: presenter,
                hint: nil,
                additionalScopes: nil,
                nonce: nonce
            ) { result, error in
                if let error = error as NSError? {
                    if error.domain == kGIDSignInErrorDomain && error.code == GIDSignInError.canceled.rawValue {
                        continuation.resume(throwing: AuthenticationError.cancelled)
                    } else {
                        continuation.resume(throwing: AuthenticationError.server("Google 登录没有完成。"))
                    }
                    return
                }
                guard let token = result?.user.idToken?.tokenString, !token.isEmpty else {
                    continuation.resume(throwing: AuthenticationError.server("Google 没有返回有效身份凭证。"))
                    return
                }
                continuation.resume(returning: token)
            }
        }
    }
}

private extension UIApplication {
    var fantoTopViewController: UIViewController? {
        let root = connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first(where: \.isKeyWindow)?
            .rootViewController
        var current = root
        while let presented = current?.presentedViewController { current = presented }
        if let navigation = current as? UINavigationController { return navigation.visibleViewController }
        if let tab = current as? UITabBarController { return tab.selectedViewController }
        return current
    }
}
