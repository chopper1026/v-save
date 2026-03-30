import XCTest
@testable import VSaveCompanion

final class DouyinCookieCollectorTests: XCTestCase {
    func testBuildCookieHeaderIncludesDouyinCookiesWhenLoginCookieExists() {
        let cookies = [
            ChromeCookieCandidate(name: "sessionid", value: "abc", domain: ".douyin.com"),
            ChromeCookieCandidate(name: "ttwid", value: "xyz", domain: ".douyin.com"),
            ChromeCookieCandidate(name: "other", value: "123", domain: ".example.com"),
        ]

        XCTAssertEqual(
            DouyinCookieCollector.buildCookieHeader(from: cookies),
            "sessionid=abc; ttwid=xyz"
        )
    }

    func testBuildCookieHeaderReturnsEmptyWhenSessionCookiesMissing() {
        let cookies = [
            ChromeCookieCandidate(name: "ttwid", value: "xyz", domain: ".douyin.com"),
        ]

        XCTAssertEqual(DouyinCookieCollector.buildCookieHeader(from: cookies), "")
    }
}
