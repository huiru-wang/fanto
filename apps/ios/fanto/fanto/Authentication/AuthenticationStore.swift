import Foundation
import Observation

@MainActor
@Observable
final class AuthenticationStore {
    static let shared = AuthenticationStore()

    enum State: Equatable {
        case restoring
        case signedOut
        case signedIn(AuthUser)
    }

    private(set) var state: State = .restoring
    var isSubmitting = false
    var error: AuthenticationError?
    private var didRestore = false

    func restore() async {
        guard !didRestore else { return }
        didRestore = true
        do {
            if let user = try await AuthSession.shared.restore() { state = .signedIn(user) }
            else { state = .signedOut }
        } catch let authError as AuthenticationError {
            if authError == .network { didRestore = false; error = authError; state = .restoring }
            else { state = .signedOut; error = authError == .expired ? nil : authError }
        } catch {
            didRestore = false; self.error = .network; state = .restoring
        }
    }

    func authenticateWithGoogle() async {
        guard !isSubmitting else { return }
        isSubmitting = true
        error = nil
        defer { isSubmitting = false }
        do {
            let intent = try await AuthAPIClient.shared.createGoogleAuthenticationIntent()
            let idToken = try await GoogleAuthenticationProvider.idToken(nonce: intent.nonce)
            let result = try await AuthAPIClient.shared.authenticateGoogle(intentID: intent.intentId, idToken: idToken)
            let user = try await AuthSession.shared.install(result)
            state = .signedIn(user)
        } catch let authError as AuthenticationError {
            if authError != .cancelled { error = authError }
        } catch {
            self.error = .server("登录没有完成，请重试。")
        }
    }

    func authenticateWithApple() async {
        guard !isSubmitting else { return }
        isSubmitting = true
        error = nil
        defer { isSubmitting = false }
        do {
            let intent = try await AuthAPIClient.shared.createAppleAuthenticationIntent()
            let idToken = try await AppleAuthenticationProvider.idToken(nonce: intent.nonce)
            let result = try await AuthAPIClient.shared.authenticateApple(intentID: intent.intentId, idToken: idToken)
            let user = try await AuthSession.shared.install(result)
            state = .signedIn(user)
        } catch let authError as AuthenticationError {
            if authError != .cancelled { error = authError }
        } catch {
            self.error = .server("登录没有完成，请重试。")
        }
    }

    func signOut() async throws {
        try await AuthSession.shared.signOut()
        await AccountCache.shared.clear()
        state = .signedOut
        error = nil
    }

    func clearError() {
        error = nil
    }

    func invalidateSession() {
        AccountCache.shared.invalidate()
        state = .signedOut
        error = nil
    }
}
