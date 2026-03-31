import XCTest
@testable import VSaveCompanion

@MainActor
final class LocalBridgeRequestHandlerTests: XCTestCase {
    func testAcceptsSplitFrontendAndBackendOriginsWhenBackendOriginProvided() async {
        let handler = makeHandler()

        XCTAssertTrue(
            handler.isAllowedOriginRequest(
                requestOrigin: "https://app.example.com",
                backendOriginHeader: "https://api.example.com",
                bodyBackendOrigin: "https://api.example.com"
            )
        )
    }

    func testRejectsMismatchedBackendOrigins() async {
        let handler = makeHandler()

        XCTAssertFalse(
            handler.isAllowedOriginRequest(
                requestOrigin: "https://app.example.com",
                backendOriginHeader: "https://api.example.com",
                bodyBackendOrigin: "https://other-api.example.com"
            )
        )
    }

    func testAcceptsConfiguredHttpAdminOrigin() async {
        let configuredOrigin = "http://admin.example.com"
        let handler = LocalBridgeRequestHandler(
            store: LocalBridgeSessionStore(),
            logger: CompanionLogger(fileManager: FileManager.default),
            validator: BackendOriginValidator(
                environment: [:],
                configuredOriginProvider: { configuredOrigin }
            )
        ) { _ in }

        XCTAssertTrue(
            handler.isAllowedOriginRequest(
                requestOrigin: configuredOrigin,
                backendOriginHeader: configuredOrigin,
                bodyBackendOrigin: configuredOrigin
            )
        )
    }

    func testAcceptsTrustedPreflight() async {
        let handler = makeHandler()

        XCTAssertTrue(
            handler.isAllowedPreflightRequest(
                requestOrigin: "https://app.example.com",
                requestedHeaders: "content-type, x-vsave-backend-origin"
            )
        )
    }

    func testOptionsHealthRespondsWithPrivateNetworkCorsHeaders() async {
        let handler = LocalBridgeRequestHandler(
            store: LocalBridgeSessionStore(),
            logger: CompanionLogger(fileManager: FileManager.default),
            validator: BackendOriginValidator(
                environment: [:],
                configuredOriginProvider: { "http://admin.example.com" }
            )
        ) { _ in }

        let response = await handler.handle(
            LocalBridgeHTTPRequest(
                method: "OPTIONS",
                path: "/health",
                headers: [
                    "Origin": "http://admin.example.com",
                    "Access-Control-Request-Headers": "x-vsave-backend-origin",
                    "Access-Control-Request-Private-Network": "true",
                ],
                body: Data()
            )
        )

        XCTAssertEqual(response.statusCode, 204)
        XCTAssertEqual(response.headers["Access-Control-Allow-Origin"], "http://admin.example.com")
        XCTAssertEqual(response.headers["Access-Control-Allow-Private-Network"], "true")
    }

    func testHealthRouteReturnsCurrentSessionAndCorsHeaders() async throws {
        let store = LocalBridgeSessionStore()
        let session = createLocalBridgeSession(
            StartLocalBridgeLoginRequest(
                authSessionId: "bridge-1",
                uploadToken: "token-1",
                expiresAt: "2099-03-24T10:20:00.000Z",
                loginUrl: CompanionConfig.douyinLoginURL,
                backendOrigin: "https://api.example.com"
            )
        )
        _ = store.startSession(session)
        let handler = makeHandler(store: store)

        let response = await handler.handle(
            LocalBridgeHTTPRequest(
                method: "GET",
                path: "/health",
                headers: [
                    "Origin": "https://app.example.com",
                    CompanionConfig.localBridgeOriginHeader: "https://api.example.com",
                ],
                body: Data()
            )
        )

        XCTAssertEqual(response.statusCode, 200)
        XCTAssertEqual(response.headers["Access-Control-Allow-Origin"], "https://app.example.com")

        let envelope = try JSONDecoder().decode(SuccessfulEnvelope<LocalBridgeHealthResponse>.self, from: response.body)
        XCTAssertEqual(envelope.data.currentSession?.authSessionId, "bridge-1")
    }

    func testLoginStartRouteStartsSessionAndReturns202() async throws {
        let expectation = expectation(description: "start login callback")
        let store = LocalBridgeSessionStore()
        let logger = CompanionLogger(fileManager: FileManager.default)
        let handler = LocalBridgeRequestHandler(
            store: store,
            logger: logger,
            validator: BackendOriginValidator(environment: [:])
        ) { _ in
            expectation.fulfill()
        }
        let requestPayload = StartLocalBridgeLoginRequest(
            authSessionId: "bridge-2",
            uploadToken: "token-2",
            expiresAt: "2099-03-24T10:25:00.000Z",
            loginUrl: CompanionConfig.douyinLoginURL,
            backendOrigin: "https://api.example.com"
        )

        let response = await handler.handle(
            LocalBridgeHTTPRequest(
                method: "POST",
                path: "/login/start",
                headers: [
                    "Origin": "https://app.example.com",
                    CompanionConfig.localBridgeOriginHeader: "https://api.example.com",
                ],
                body: try JSONEncoder().encode(requestPayload)
            )
        )

        XCTAssertEqual(response.statusCode, 202)
        XCTAssertEqual(store.getCurrentSession()?.authSessionId, "bridge-2")
        await fulfillment(of: [expectation], timeout: 1)
    }

    private func makeHandler(store: LocalBridgeSessionStore = LocalBridgeSessionStore()) -> LocalBridgeRequestHandler {
        LocalBridgeRequestHandler(
            store: store,
            logger: CompanionLogger(fileManager: FileManager.default),
            validator: BackendOriginValidator(environment: [:])
        ) { _ in }
    }
}
