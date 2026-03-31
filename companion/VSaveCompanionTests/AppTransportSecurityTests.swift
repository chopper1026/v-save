import XCTest

final class AppTransportSecurityTests: XCTestCase {
    func testHostApplicationAllowsHttpServerSync() {
        let ats = Bundle.main.object(forInfoDictionaryKey: "NSAppTransportSecurity") as? [String: Any]
        let allowsArbitraryLoads = ats?["NSAllowsArbitraryLoads"] as? Bool

        XCTAssertEqual(allowsArbitraryLoads, true)
    }
}
