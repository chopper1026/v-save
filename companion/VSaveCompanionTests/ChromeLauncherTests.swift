import XCTest
@testable import VSaveCompanion

final class ChromeLauncherTests: XCTestCase {
    func testBuildArgumentsMatchLegacyContract() {
        let arguments = ChromeLauncher.buildArguments(
            userDataDirectory: "/tmp/chrome-profile",
            remoteDebuggingPort: 9222,
            loginURL: CompanionConfig.douyinLoginURL
        )

        XCTAssertEqual(
            arguments,
            [
                "--user-data-dir=/tmp/chrome-profile",
                "--remote-debugging-port=9222",
                "--no-first-run",
                "--no-default-browser-check",
                "--new-window",
                CompanionConfig.douyinLoginURL,
            ]
        )
    }
}
