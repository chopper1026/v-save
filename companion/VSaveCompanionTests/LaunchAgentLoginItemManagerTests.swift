import Foundation
import XCTest
@testable import VSaveCompanion

final class LaunchAgentLoginItemManagerTests: XCTestCase {
    private var tempDirectoryURL: URL?

    override func tearDown() async throws {
        if let tempDirectoryURL {
            try? FileManager.default.removeItem(at: tempDirectoryURL)
        }
        tempDirectoryURL = nil
    }

    func testSetEnabledTrueWritesLaunchAgentPlist() throws {
        let fixture = try makeFixture()
        let manager = LaunchAgentLoginItemManager(
            fileManager: .default,
            plistURL: fixture.plistURL,
            executablePath: "/Applications/V-SAVE Companion.app/Contents/MacOS/V-SAVE Companion"
        )

        try manager.setEnabled(true)

        XCTAssertTrue(manager.isEnabled())
        let data = try Data(contentsOf: fixture.plistURL)
        let plist = try XCTUnwrap(
            PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any]
        )

        XCTAssertEqual(plist["Label"] as? String, CompanionConfig.launchAgentLabel)
        XCTAssertEqual(
            plist["ProgramArguments"] as? [String],
            ["/Applications/V-SAVE Companion.app/Contents/MacOS/V-SAVE Companion"]
        )
        XCTAssertEqual(plist["RunAtLoad"] as? Bool, true)
    }

    func testSetEnabledFalseRemovesLaunchAgentPlist() throws {
        let fixture = try makeFixture()
        let manager = LaunchAgentLoginItemManager(
            fileManager: .default,
            plistURL: fixture.plistURL,
            executablePath: "/Applications/V-SAVE Companion.app/Contents/MacOS/V-SAVE Companion"
        )
        try manager.setEnabled(true)

        try manager.setEnabled(false)

        XCTAssertFalse(manager.isEnabled())
        XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.plistURL.path))
    }

    private func makeFixture() throws -> (rootURL: URL, plistURL: URL) {
        let rootURL = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: rootURL, withIntermediateDirectories: true)
        tempDirectoryURL = rootURL
        return (
            rootURL,
            rootURL.appendingPathComponent("com.vsave.companion.launch-agent.plist", isDirectory: false)
        )
    }
}
