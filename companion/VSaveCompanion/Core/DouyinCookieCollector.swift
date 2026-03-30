import Foundation

private struct DevToolsCookieResult: Decodable {
    let cookies: [ChromeCookieCandidate]
}

private struct DevToolsEnvelope<Result: Decodable>: Decodable {
    struct ErrorPayload: Decodable {
        let message: String?
    }

    let id: Int?
    let result: Result?
    let error: ErrorPayload?
}

enum DouyinCookieCollector {
    static func buildCookieHeader(from cookies: [ChromeCookieCandidate]) -> String {
        let douyinCookies = cookies.filter { cookie in
            cookie.domain.contains("douyin.com")
                && !cookie.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                && !cookie.value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }

        let hasLoggedInCookie = douyinCookies.contains { cookie in
            cookie.name == "sessionid" || cookie.name == "sessionid_ss"
        }

        guard hasLoggedInCookie else {
            return ""
        }

        return douyinCookies.map { "\($0.name)=\($0.value)" }.joined(separator: "; ")
    }

    static func waitForLoginCookie(
        remoteDebuggingPort: Int,
        timeoutSeconds: TimeInterval = CompanionConfig.loginWatchTimeoutSeconds,
        pollIntervalSeconds: TimeInterval = 1,
        session: URLSession = .shared
    ) async throws -> String {
        let websocketURL = try await ChromeLauncher.waitForDebuggingEndpoint(
            remoteDebuggingPort: remoteDebuggingPort,
            session: session
        )
        let client = ChromeDevToolsClient(url: websocketURL, session: session)
        try await client.connect()
        defer {
            client.disconnect()
        }

        let deadline = Date().addingTimeInterval(timeoutSeconds)
        while Date() < deadline {
            try Task.checkCancellation()
            let cookies = try await readBrowserCookies(client: client)
            let cookieHeader = buildCookieHeader(from: cookies)
            if !cookieHeader.isEmpty {
                return cookieHeader
            }

            try await Task.sleep(for: .milliseconds(Int(pollIntervalSeconds * 1000)))
        }

        throw NSError(
            domain: CompanionConfig.appName,
            code: 6,
            userInfo: [NSLocalizedDescriptionKey: "等待抖音登录 Cookie 超时，请重新发起扫码登录"]
        )
    }

    private static func readBrowserCookies(client: ChromeDevToolsClient) async throws -> [ChromeCookieCandidate] {
        do {
            let payload = try await client.request(
                method: "Network.getAllCookies",
                responseType: DevToolsCookieResult.self
            )
            return payload.cookies
        } catch {
            let payload = try await client.request(
                method: "Storage.getCookies",
                responseType: DevToolsCookieResult.self
            )
            return payload.cookies
        }
    }
}

final class ChromeDevToolsClient {
    private let url: URL
    private let session: URLSession
    private var socket: URLSessionWebSocketTask?
    private var nextIdentifier = 1

    init(url: URL, session: URLSession = .shared) {
        self.url = url
        self.session = session
    }

    func connect() async throws {
        let socket = session.webSocketTask(with: url)
        socket.resume()
        self.socket = socket
    }

    func disconnect() {
        socket?.cancel(with: .normalClosure, reason: nil)
        socket = nil
    }

    func request<Response: Decodable>(
        method: String,
        responseType: Response.Type
    ) async throws -> Response {
        guard let socket else {
            throw NSError(
                domain: CompanionConfig.appName,
                code: 7,
                userInfo: [NSLocalizedDescriptionKey: "Chrome 调试连接未初始化"]
            )
        }

        let id = nextIdentifier
        nextIdentifier += 1

        let payload: [String: Any] = [
            "id": id,
            "method": method,
        ]
        let data = try JSONSerialization.data(withJSONObject: payload, options: [])
        let text = String(decoding: data, as: UTF8.self)
        try await socket.send(.string(text))

        while true {
            let socketMessage = try await socket.receive()
            let messageData: Data
            switch socketMessage {
            case let .string(text):
                messageData = Data(text.utf8)
            case let .data(data):
                messageData = data
            @unknown default:
                continue
            }

            let envelope = try JSONDecoder().decode(DevToolsEnvelope<Response>.self, from: messageData)
            guard envelope.id == id else {
                continue
            }

            if let result = envelope.result {
                return result
            }

            let errorMessage = envelope.error?.message ?? "Chrome DevTools 请求失败"
            throw NSError(
                domain: CompanionConfig.appName,
                code: 8,
                userInfo: [NSLocalizedDescriptionKey: errorMessage]
            )
        }
    }
}
