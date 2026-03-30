import Foundation
import XCTest
@testable import VSaveCompanion

final class ServerSyncClientTests: XCTestCase {
    override func tearDown() {
        MockURLProtocol.requestHandler = nil
    }

    func testCompleteBridgeAuthPostsExpectedPayload() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let client = CompanionServerSyncClient(session: session)

        MockURLProtocol.requestHandler = { request in
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.url?.absoluteString, "https://api.example.com/api/douyin/auth/bridge/complete")

            let payload = try JSONDecoder().decode(CompleteBridgeAuthRequest.self, from: requestBody(from: request))
            XCTAssertEqual(payload.authSessionId, "bridge-1")
            XCTAssertEqual(payload.uploadToken, "token-1")
            XCTAssertEqual(payload.cookieHeader, "sessionid=abc")

            let responseBody = try JSONEncoder().encode(
                SuccessfulEnvelope(
                    data: CompleteBridgeAuthResponse(
                        authSessionId: "bridge-1",
                        status: "confirmed",
                        completedAt: "2026-03-24T02:30:00.000Z"
                    )
                )
            )

            return (
                HTTPURLResponse(
                    url: request.url!,
                    statusCode: 200,
                    httpVersion: nil,
                    headerFields: ["Content-Type": "application/json"]
                )!,
                responseBody
            )
        }

        let response = try await client.completeBridgeAuth(
            payload: CompleteBridgeAuthRequest(
                authSessionId: "bridge-1",
                uploadToken: "token-1",
                cookieHeader: "sessionid=abc"
            ),
            backendOrigin: "https://api.example.com"
        )

        XCTAssertEqual(response.authSessionId, "bridge-1")
        XCTAssertEqual(response.status, "confirmed")
    }

    func testCompleteBridgeAuthAcceptsCreatedResponse() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let client = CompanionServerSyncClient(session: session)

        MockURLProtocol.requestHandler = { request in
            let responseBody = try JSONEncoder().encode(
                SuccessfulEnvelope(
                    data: CompleteBridgeAuthResponse(
                        authSessionId: "bridge-2",
                        status: "confirmed",
                        completedAt: "2026-03-24T04:00:00.000Z"
                    )
                )
            )

            return (
                HTTPURLResponse(
                    url: request.url!,
                    statusCode: 201,
                    httpVersion: nil,
                    headerFields: ["Content-Type": "application/json"]
                )!,
                responseBody
            )
        }

        let response = try await client.completeBridgeAuth(
            payload: CompleteBridgeAuthRequest(
                authSessionId: "bridge-2",
                uploadToken: "token-2",
                cookieHeader: "sessionid=def"
            ),
            backendOrigin: "https://api.example.com"
        )

        XCTAssertEqual(response.authSessionId, "bridge-2")
        XCTAssertEqual(response.status, "confirmed")
    }
}

private func requestBody(from request: URLRequest) -> Data {
    if let body = request.httpBody {
        return body
    }

    guard let stream = request.httpBodyStream else {
        return Data()
    }

    stream.open()
    defer { stream.close() }

    var data = Data()
    let bufferSize = 1024
    let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: bufferSize)
    defer { buffer.deallocate() }

    while stream.hasBytesAvailable {
        let read = stream.read(buffer, maxLength: bufferSize)
        guard read > 0 else {
            break
        }
        data.append(buffer, count: read)
    }

    return data
}

private final class MockURLProtocol: URLProtocol {
    nonisolated(unsafe) static var requestHandler: ((URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool {
        true
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        request
    }

    override func startLoading() {
        guard let handler = MockURLProtocol.requestHandler else {
            return
        }

        do {
            let (response, data) = try handler(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}
