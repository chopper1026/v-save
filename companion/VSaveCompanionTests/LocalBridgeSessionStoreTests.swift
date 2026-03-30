import XCTest
@testable import VSaveCompanion

@MainActor
final class LocalBridgeSessionStoreTests: XCTestCase {
    func testStoreKeepsOnlyOneActiveSession() {
        let store = LocalBridgeSessionStore()
        let first = createLocalBridgeSession(
            StartLocalBridgeLoginRequest(
                authSessionId: "bridge-1",
                uploadToken: "token-1",
                expiresAt: "2099-03-24T10:00:00.000Z",
                loginUrl: CompanionConfig.douyinLoginURL,
                backendOrigin: "https://admin.example.com"
            )
        )
        _ = store.startSession(first)

        let second = createLocalBridgeSession(
            StartLocalBridgeLoginRequest(
                authSessionId: "bridge-2",
                uploadToken: "token-2",
                expiresAt: "2099-03-24T10:05:00.000Z",
                loginUrl: CompanionConfig.douyinLoginURL,
                backendOrigin: "https://admin.example.com"
            )
        )
        let previous = store.startSession(second)

        XCTAssertEqual(previous?.authSessionId, "bridge-1")
        XCTAssertEqual(previous?.status, .failed)
        XCTAssertTrue(previous?.lastError?.contains("已被新的登录会话替代") == true)
        XCTAssertEqual(store.getCurrentSession()?.authSessionId, "bridge-2")
    }

    func testStoreUpdatesAndPublishesCurrentSession() {
        let store = LocalBridgeSessionStore()
        let session = createLocalBridgeSession(
            StartLocalBridgeLoginRequest(
                authSessionId: "bridge-3",
                uploadToken: "token-3",
                expiresAt: "2099-03-24T10:10:00.000Z",
                loginUrl: CompanionConfig.douyinLoginURL,
                backendOrigin: "https://admin.example.com"
            )
        )
        _ = store.startSession(session)
        _ = store.updateStatus(authSessionId: "bridge-3", status: .waitingScan)

        XCTAssertEqual(store.getCurrentSession()?.status, .waitingScan)
        XCTAssertEqual(store.getPublicSession()?.authSessionId, "bridge-3")
    }

    func testStoreNotifiesSubscribers() {
        let store = LocalBridgeSessionStore()
        var events: [String?] = []
        let subscriptionID = store.subscribe { session in
            events.append(session?.status.rawValue)
        }

        let session = createLocalBridgeSession(
            StartLocalBridgeLoginRequest(
                authSessionId: "bridge-4",
                uploadToken: "token-4",
                expiresAt: "2099-03-24T10:15:00.000Z",
                loginUrl: CompanionConfig.douyinLoginURL,
                backendOrigin: "https://admin.example.com"
            )
        )
        _ = store.startSession(session)
        _ = store.updateStatus(authSessionId: "bridge-4", status: .waitingScan)
        store.clearCurrentSession(authSessionId: "bridge-4")
        store.unsubscribe(subscriptionID)

        XCTAssertEqual(events, ["waiting_helper", "waiting_scan", nil])
    }
}
