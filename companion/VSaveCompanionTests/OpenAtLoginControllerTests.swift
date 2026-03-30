import XCTest
@testable import VSaveCompanion

final class OpenAtLoginControllerTests: XCTestCase {
    private var tempDirectoryURL: URL?

    override func tearDown() async throws {
        if let tempDirectoryURL {
            try? FileManager.default.removeItem(at: tempDirectoryURL)
        }
        tempDirectoryURL = nil
    }

    func testInitializeEnablesOpenAtLoginByDefaultOnFirstLaunch() throws {
        let settingsURL = try makeSettingsURL()
        let loginItemManager = MockLoginItemManager(initialEnabled: false)
        let controller = OpenAtLoginController(
            loginItemManager: loginItemManager,
            preferencesURL: settingsURL
        )

        let state = controller.initialize()
        let data = try Data(contentsOf: settingsURL)
        let preferences = try JSONDecoder().decode(OpenAtLoginPreferences.self, from: data)

        XCTAssertEqual(loginItemManager.setCalls, [true])
        XCTAssertEqual(state, OpenAtLoginState(enabled: true, lastError: nil))
        XCTAssertEqual(preferences, OpenAtLoginPreferences(initialized: true, openAtLoginEnabled: true))
    }

    func testInitializePreservesExplicitDisabledChoiceAcrossRestarts() throws {
        let settingsURL = try makeSettingsURL()
        let preferences = OpenAtLoginPreferences(initialized: true, openAtLoginEnabled: false)
        try JSONEncoder().encode(preferences).write(to: settingsURL, options: .atomic)

        let loginItemManager = MockLoginItemManager(initialEnabled: true)
        let controller = OpenAtLoginController(
            loginItemManager: loginItemManager,
            preferencesURL: settingsURL
        )

        let state = controller.initialize()

        XCTAssertEqual(loginItemManager.setCalls, [false])
        XCTAssertEqual(state, OpenAtLoginState(enabled: false, lastError: nil))
    }

    func testSetEnabledReturnsCurrentStateWhenSystemUpdateFails() throws {
        let settingsURL = try makeSettingsURL()
        let preferences = OpenAtLoginPreferences(initialized: true, openAtLoginEnabled: true)
        try JSONEncoder().encode(preferences).write(to: settingsURL, options: .atomic)

        let loginItemManager = MockLoginItemManager(initialEnabled: true, failureMessage: "login item update failed")
        let controller = OpenAtLoginController(
            loginItemManager: loginItemManager,
            preferencesURL: settingsURL
        )

        let state = controller.setEnabled(false)
        let persisted = try JSONDecoder().decode(OpenAtLoginPreferences.self, from: Data(contentsOf: settingsURL))

        XCTAssertEqual(state, OpenAtLoginState(enabled: true, lastError: "login item update failed"))
        XCTAssertEqual(persisted, preferences)
    }

    private func makeSettingsURL() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        self.tempDirectoryURL = url
        return url.appendingPathComponent("settings.json", isDirectory: false)
    }
}

private final class MockLoginItemManager: LoginItemManaging {
    private(set) var enabled: Bool
    private let failureMessage: String?
    private(set) var setCalls: [Bool] = []

    init(initialEnabled: Bool, failureMessage: String? = nil) {
        self.enabled = initialEnabled
        self.failureMessage = failureMessage
    }

    func isEnabled() -> Bool {
        enabled
    }

    func setEnabled(_ enabled: Bool) throws {
        setCalls.append(enabled)
        if let failureMessage {
            throw NSError(domain: "test", code: 1, userInfo: [NSLocalizedDescriptionKey: failureMessage])
        }

        self.enabled = enabled
    }
}
