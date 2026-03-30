import Darwin
import Foundation

struct ChromeVersionResponse: Decodable {
    let webSocketDebuggerUrl: String?
}

final class LaunchedChrome: @unchecked Sendable {
    let process: Process
    let remoteDebuggingPort: Int
    let userDataURL: URL

    init(process: Process, remoteDebuggingPort: Int, userDataURL: URL) {
        self.process = process
        self.remoteDebuggingPort = remoteDebuggingPort
        self.userDataURL = userDataURL
    }

    func stop() async {
        guard process.isRunning else {
            return
        }

        process.terminate()

        let deadline = Date().addingTimeInterval(3)
        while process.isRunning && Date() < deadline {
            try? await Task.sleep(for: .milliseconds(100))
        }

        if process.isRunning {
            kill(process.processIdentifier, SIGKILL)
        }
    }
}

enum ChromeLauncher {
    static func buildArguments(
        userDataDirectory: String,
        remoteDebuggingPort: Int,
        loginURL: String
    ) -> [String] {
        [
            "--user-data-dir=\(userDataDirectory)",
            "--remote-debugging-port=\(remoteDebuggingPort)",
            "--no-first-run",
            "--no-default-browser-check",
            "--new-window",
            loginURL,
        ]
    }

    static func launch(
        executablePath: String,
        userDataURL: URL,
        loginURL: String,
        remoteDebuggingPort: Int? = nil
    ) throws -> LaunchedChrome {
        try FileManager.default.createDirectory(at: userDataURL, withIntermediateDirectories: true)
        let debugPort = try remoteDebuggingPort ?? findFreePort()

        let process = Process()
        process.executableURL = URL(fileURLWithPath: executablePath)
        process.arguments = buildArguments(
            userDataDirectory: userDataURL.path,
            remoteDebuggingPort: debugPort,
            loginURL: loginURL
        )
        process.standardOutput = nil
        process.standardError = nil
        try process.run()

        return LaunchedChrome(
            process: process,
            remoteDebuggingPort: debugPort,
            userDataURL: userDataURL
        )
    }

    static func waitForDebuggingEndpoint(
        remoteDebuggingPort: Int,
        timeoutSeconds: TimeInterval = 10,
        pollIntervalSeconds: TimeInterval = 0.25,
        session: URLSession = .shared
    ) async throws -> URL {
        let endpoint = URL(string: "http://127.0.0.1:\(remoteDebuggingPort)/json/version")!
        let deadline = Date().addingTimeInterval(timeoutSeconds)

        while Date() < deadline {
            try Task.checkCancellation()
            do {
                let (data, response) = try await session.data(from: endpoint)
                if let http = response as? HTTPURLResponse, http.statusCode == 200 {
                    let payload = try JSONDecoder().decode(ChromeVersionResponse.self, from: data)
                    if let websocket = payload.webSocketDebuggerUrl, let url = URL(string: websocket) {
                        return url
                    }
                }
            } catch {
                // Devtools endpoint not ready yet.
            }

            try await Task.sleep(for: .milliseconds(Int(pollIntervalSeconds * 1000)))
        }

        throw NSError(
            domain: CompanionConfig.appName,
            code: 2,
            userInfo: [NSLocalizedDescriptionKey: "等待 Chrome 调试端口就绪超时: \(endpoint.absoluteString)"]
        )
    }

    static func findFreePort() throws -> Int {
        let socketFD = socket(AF_INET, SOCK_STREAM, 0)
        guard socketFD >= 0 else {
            throw NSError(
                domain: CompanionConfig.appName,
                code: 3,
                userInfo: [NSLocalizedDescriptionKey: "无法分配 Chrome 调试端口"]
            )
        }
        defer { close(socketFD) }

        var value: Int32 = 1
        setsockopt(socketFD, SOL_SOCKET, SO_REUSEADDR, &value, socklen_t(MemoryLayout.size(ofValue: value)))

        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = in_port_t(0).bigEndian
        address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))

        let bindResult = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockPtr in
                bind(socketFD, sockPtr, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }

        guard bindResult == 0 else {
            throw NSError(
                domain: CompanionConfig.appName,
                code: 4,
                userInfo: [NSLocalizedDescriptionKey: "无法绑定临时调试端口"]
            )
        }

        var length = socklen_t(MemoryLayout<sockaddr_in>.size)
        var boundAddress = sockaddr_in()
        let nameResult = withUnsafeMutablePointer(to: &boundAddress) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockPtr in
                getsockname(socketFD, sockPtr, &length)
            }
        }

        guard nameResult == 0 else {
            throw NSError(
                domain: CompanionConfig.appName,
                code: 5,
                userInfo: [NSLocalizedDescriptionKey: "无法读取临时调试端口"]
            )
        }

        return Int(UInt16(bigEndian: boundAddress.sin_port))
    }
}
