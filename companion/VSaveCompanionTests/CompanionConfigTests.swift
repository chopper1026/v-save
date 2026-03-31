import XCTest
@testable import VSaveCompanion

final class CompanionConfigTests: XCTestCase {
    func testChromeProfileURLUsesDistinctSessionDirectories() {
        let first = CompanionConfig.chromeProfileURL()
        let second = CompanionConfig.chromeProfileURL()

        XCTAssertNotEqual(first, second)
        XCTAssertEqual(first.deletingLastPathComponent().lastPathComponent, "chrome-profiles")
        XCTAssertEqual(second.deletingLastPathComponent().lastPathComponent, "chrome-profiles")
    }
}
