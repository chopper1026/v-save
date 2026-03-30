import Foundation

@MainActor
final class LocalBridgeSessionStore {
    private let replacedSessionReason = "已被新的登录会话替代，请使用最新扫码流程"
    private var currentSession: LocalBridgeSession?
    private var subscribers: [UUID: (LocalBridgeSession?) -> Void] = [:]

    func subscribe(_ listener: @escaping (LocalBridgeSession?) -> Void) -> UUID {
        let id = UUID()
        subscribers[id] = listener
        return id
    }

    func unsubscribe(_ id: UUID) {
        subscribers.removeValue(forKey: id)
    }

    func startSession(_ nextSession: LocalBridgeSession) -> LocalBridgeSession? {
        let previous = normalizedCurrentSession()
        if let previous {
            currentSession = LocalBridgeSession(
                authSessionId: previous.authSessionId,
                uploadToken: previous.uploadToken,
                backendOrigin: previous.backendOrigin,
                expiresAt: previous.expiresAt,
                loginUrl: previous.loginUrl,
                status: .failed,
                startedAt: previous.startedAt,
                completedAt: ISO8601Timestamp.now(),
                lastError: replacedSessionReason,
                chromeDebugPort: previous.chromeDebugPort,
                chromePid: previous.chromePid
            )
        }

        let replaced = currentSession
        currentSession = nextSession
        notify()
        return replaced
    }

    func getCurrentSession() -> LocalBridgeSession? {
        normalizedCurrentSession()
    }

    func getPublicSession() -> PublicLocalBridgeSession? {
        normalizedCurrentSession()?.publicSession
    }

    @discardableResult
    func updateStatus(
        authSessionId: String,
        status: LocalBridgeSessionStatus,
        lastError: String? = nil
    ) -> LocalBridgeSession? {
        guard var session = normalizedCurrentSession(), session.authSessionId == authSessionId else {
            return nil
        }

        session.status = status
        session.lastError = lastError
        if status == .confirmed || status == .failed || status == .expired {
            session.completedAt = ISO8601Timestamp.now()
        }

        currentSession = session
        notify()
        return session
    }

    @discardableResult
    func updateChromeRuntime(
        authSessionId: String,
        metadata: ChromeRuntimeMetadata
    ) -> LocalBridgeSession? {
        guard var session = normalizedCurrentSession(), session.authSessionId == authSessionId else {
            return nil
        }

        session.chromeDebugPort = metadata.chromeDebugPort ?? session.chromeDebugPort
        session.chromePid = metadata.chromePid ?? session.chromePid
        currentSession = session
        notify()
        return session
    }

    func clearCurrentSession(authSessionId: String? = nil) {
        if authSessionId == nil || currentSession?.authSessionId == authSessionId {
            currentSession = nil
            notify()
        }
    }

    private func normalizedCurrentSession() -> LocalBridgeSession? {
        guard var session = currentSession else {
            return nil
        }

        if session.status != .confirmed,
           session.status != .failed,
           session.status != .expired,
           let expiresAt = ISO8601Timestamp.parse(session.expiresAt),
           Date() >= expiresAt {
            session.status = .expired
            session.lastError = "本机登录会话已过期，请重新发起"
            session.completedAt = ISO8601Timestamp.now()
            currentSession = session
            notify()
        }

        return currentSession
    }

    private func notify() {
        let snapshot = currentSession
        subscribers.values.forEach { $0(snapshot) }
    }
}
