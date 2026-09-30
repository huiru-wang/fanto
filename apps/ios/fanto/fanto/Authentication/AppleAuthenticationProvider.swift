import AuthenticationServices
import UIKit

@MainActor
enum AppleAuthenticationProvider {
    private static var activeCoordinator: AppleAuthorizationCoordinator?

    static func idToken(nonce: String) async throws -> String {
        try await withCheckedThrowingContinuation { continuation in
            guard let presentationAnchor = UIApplication.shared.fantoAuthorizationWindow else {
                continuation.resume(throwing: AuthenticationError.configuration("暂时无法打开 Apple 登录。"))
                return
            }

            let request = ASAuthorizationAppleIDProvider().createRequest()
            request.requestedScopes = [.email]
            request.nonce = nonce

            let coordinator = AppleAuthorizationCoordinator(
                continuation: continuation,
                presentationAnchor: presentationAnchor
            )
            activeCoordinator = coordinator
            coordinator.start(request: request)
        }
    }

    fileprivate static func complete(_ coordinator: AppleAuthorizationCoordinator) {
        guard activeCoordinator === coordinator else { return }
        activeCoordinator = nil
    }
}

@MainActor
private final class AppleAuthorizationCoordinator: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    private var continuation: CheckedContinuation<String, Error>?
    private let presentationAnchor: ASPresentationAnchor
    private var controller: ASAuthorizationController?

    init(
        continuation: CheckedContinuation<String, Error>,
        presentationAnchor: ASPresentationAnchor
    ) {
        self.continuation = continuation
        self.presentationAnchor = presentationAnchor
    }

    func start(request: ASAuthorizationAppleIDRequest) {
        let controller = ASAuthorizationController(authorizationRequests: [request])
        self.controller = controller
        controller.delegate = self
        controller.presentationContextProvider = self
        controller.performRequests()
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              let identityToken = credential.identityToken,
              let token = String(data: identityToken, encoding: .utf8),
              !token.isEmpty else {
            finish(.failure(AuthenticationError.server("Apple 没有返回有效身份凭证。")))
            return
        }
        finish(.success(token))
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        let nsError = error as NSError
        if nsError.domain == ASAuthorizationError.errorDomain,
           nsError.code == ASAuthorizationError.canceled.rawValue {
            finish(.failure(AuthenticationError.cancelled))
        } else {
            finish(.failure(AuthenticationError.server("Apple 登录没有完成。")))
        }
    }

    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        presentationAnchor
    }

    private func finish(_ result: Result<String, Error>) {
        guard let continuation else { return }
        self.continuation = nil
        controller = nil
        AppleAuthenticationProvider.complete(self)
        continuation.resume(with: result)
    }
}

private extension UIApplication {
    var fantoAuthorizationWindow: UIWindow? {
        connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first(where: \.isKeyWindow)
    }
}
