import AppKit
import XCTest
@testable import VSaveCompanion

final class StatusBarPresentationTests: XCTestCase {
    @MainActor
    private final class DummyTarget: NSObject {
        @objc func handleMenuItem(_ sender: NSMenuItem) {}
    }

    func testCompanionConfigUsesUnifiedCompanionName() {
        XCTAssertEqual(CompanionConfig.appName, "V-SAVE Companion")
    }

    func testBuildStatusPanelSnapshotMapsRuntimeState() {
        let snapshot = buildStatusPanelSnapshot(
            from: CompanionRuntimeSnapshot(
                appVersion: "1.0.0",
                lastRestartAt: "2026-03-24T02:09:20.860Z",
                serverStatus: "running",
                serverAddress: "http://127.0.0.1:37219",
                chromeStatus: "ready",
                currentSession: PublicLocalBridgeSession(
                    authSessionId: "bridge-1",
                    backendOrigin: "https://api.example.com",
                    expiresAt: "2026-03-24T02:20:00.000Z",
                    loginUrl: CompanionConfig.douyinLoginURL,
                    status: .waitingScan,
                    startedAt: "2026-03-24T02:00:00.000Z",
                    completedAt: nil,
                    lastError: nil,
                    chromeDebugPort: 9222,
                    chromePid: 12345
                ),
                lastError: nil,
                openAtLoginEnabled: true,
                openAtLoginError: nil
            )
        )

        XCTAssertEqual(snapshot.helperStatus, "运行中")
        XCTAssertEqual(snapshot.chromeStatus, "已检测到")
        XCTAssertEqual(snapshot.currentSessionStatus, "等待扫码")
        XCTAssertTrue(snapshot.openAtLoginEnabled)
    }

    @MainActor
    func testStatusBarMenuBuilderBuildsSectionsAndActions() {
        let target = DummyTarget()
        let snapshot = StatusPanelSnapshot(
            appVersion: "1.0.0",
            helperStatus: "运行中",
            helperTone: .success,
            serverAddress: "http://127.0.0.1:37219",
            chromeStatus: "已检测到",
            currentSessionId: "无活动会话",
            currentSessionStatus: "--",
            currentSessionExpiresAt: "--",
            lastError: nil,
            openAtLoginEnabled: true,
            openAtLoginError: nil,
            lastRestartAt: "2026-03-24 10:09:20"
        )

        let menu = StatusBarMenuBuilder(
            snapshot: snapshot,
            target: target,
            actionSelector: #selector(DummyTarget.handleMenuItem(_:))
        ).buildMenu()

        XCTAssertEqual(menu.items.count, 8)
        XCTAssertNotNil(menu.items.first?.view)
        XCTAssertFalse(menu.items.contains(where: { $0.isSeparatorItem }))
        XCTAssertLessThanOrEqual(menu.items.first?.view?.frame.width ?? .greatestFiniteMagnitude, 332)
        XCTAssertEqual(menu.items.suffix(3).map { $0.title }, ["关闭开机自启", "重启助手", "退出助手"])
        XCTAssertTrue(menu.items.suffix(3).allSatisfy { $0.view == nil })
    }
}
