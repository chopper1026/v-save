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
        let preferences = AdminPageOriginPreferences(adminPageOrigin: "https://admin.example.com")
        try JSONEncoder().encode(preferences).write(to: settingsURL, options: .atomic)

        let controller = AdminPageOriginController(preferencesURL: settingsURL)

        XCTAssertEqual(controller.currentOrigin(), "https://admin.example.com")
    }

    func testSetOriginNormalizesAndPersistsOrigin() throws {
        let settingsURL = try makeSettingsURL()
        let controller = AdminPageOriginController(preferencesURL: settingsURL)

        let state = controller.setOrigin(" https://admin.example.com/admin/auth?tab=douyin ")
        let persisted = try JSONDecoder().decode(
            AdminPageOriginPreferences.self,
            from: Data(contentsOf: settingsURL)
        )

        XCTAssertEqual(state.origin, "https://admin.example.com")
        XCTAssertNil(state.lastError)
        XCTAssertEqual(persisted.adminPageOrigin, "https://admin.example.com")
    }

    func testSetOriginAllowsClearingConfiguredOrigin() throws {
        let settingsURL = try makeSettingsURL()
        let controller = AdminPageOriginController(preferencesURL: settingsURL)
        _ = controller.setOrigin("https://admin.example.com")

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
