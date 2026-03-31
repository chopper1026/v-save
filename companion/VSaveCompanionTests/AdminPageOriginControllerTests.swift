import XCTest
@testable import VSaveCompanion

final class AdminPageOriginControllerTests: XCTestCase {
    private var tempDirectoryURL: URL?

    override func tearDown() async throws {
        if let tempDirectoryURL {
            try? FileManager.default.removeItem(at: tempDirectoryURL)
        }
        tempDirectoryURL = nil
    }

    func testInitializeReturnsPersistedAdminPageOrigin() throws {
        let settingsURL = try makeSettingsURL()
        let preferences = AdminPageOriginPreferences(adminPageOrigin: "http://115.190.228.9")
        try JSONEncoder().encode(preferences).write(to: settingsURL, options: .atomic)

        let controller = AdminPageOriginController(preferencesURL: settingsURL)

        XCTAssertEqual(controller.currentOrigin(), "http://115.190.228.9")
    }

    func testSetOriginNormalizesAndPersistsOrigin() throws {
        let settingsURL = try makeSettingsURL()
        let controller = AdminPageOriginController(preferencesURL: settingsURL)

        let state = controller.setOrigin(" http://115.190.228.9/admin/auth?tab=douyin ")
        let persisted = try JSONDecoder().decode(
            AdminPageOriginPreferences.self,
            from: Data(contentsOf: settingsURL)
        )

        XCTAssertEqual(state.origin, "http://115.190.228.9")
        XCTAssertNil(state.lastError)
        XCTAssertEqual(persisted.adminPageOrigin, "http://115.190.228.9")
    }

    func testSetOriginAllowsClearingConfiguredOrigin() throws {
        let settingsURL = try makeSettingsURL()
        let controller = AdminPageOriginController(preferencesURL: settingsURL)
        _ = controller.setOrigin("http://115.190.228.9")

        let state = controller.setOrigin("   ")
        let persisted = try JSONDecoder().decode(
            AdminPageOriginPreferences.self,
            from: Data(contentsOf: settingsURL)
        )

        XCTAssertNil(state.origin)
        XCTAssertNil(state.lastError)
        XCTAssertNil(persisted.adminPageOrigin)
    }

    private func makeSettingsURL() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        tempDirectoryURL = url
        return url.appendingPathComponent("admin-page-origin-settings.json", isDirectory: false)
    }
}
