import Foundation
@preconcurrency import Network

private enum HTTPServerError: LocalizedError {
    case connectionClosed
    case malformedRequest
    case invalidLocalEndpoint

    var errorDescription: String? {
        switch self {
        case .connectionClosed:
            return "连接已关闭"
        case .malformedRequest:
            return "请求格式无效"
        case .invalidLocalEndpoint:
            return "无法绑定本地桥接地址"
        }
    }
}

private final class ContinuationState: @unchecked Sendable {
    var hasResumed = false
}

final class HTTPServer: @unchecked Sendable {
    private let host: String
    private let port: UInt16
    private let handler: (LocalBridgeHTTPRequest) async -> LocalBridgeHTTPResponse
    private let queue = DispatchQueue(label: "com.vsave.companion.http-server")
    private var listener: NWListener?

    init(
        host: String,
        port: UInt16,
        handler: @escaping (LocalBridgeHTTPRequest) async -> LocalBridgeHTTPResponse
    ) {
        self.host = host
        self.port = port
        self.handler = handler
    }

    func start() async throws {
        guard listener == nil else {
            return
        }

        let parameters = NWParameters.tcp
        parameters.allowLocalEndpointReuse = true
        guard let ipAddress = IPv4Address(host),
              let endpointPort = NWEndpoint.Port(rawValue: port) else {
            throw HTTPServerError.invalidLocalEndpoint
        }
        parameters.requiredLocalEndpoint = .hostPort(host: .ipv4(ipAddress), port: endpointPort)

        let listener = try NWListener(using: parameters)
        self.listener = listener

        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            let state = ContinuationState()

            listener.stateUpdateHandler = { listenerState in
                switch listenerState {
                case .ready:
                    guard !state.hasResumed else { return }
                    state.hasResumed = true
                    continuation.resume()
                case let .failed(error):
                    guard !state.hasResumed else { return }
                    state.hasResumed = true
                    continuation.resume(throwing: error)
                default:
                    break
                }
            }

            listener.newConnectionHandler = { [weak self] connection in
                self?.handle(connection: connection)
            }

            listener.start(queue: queue)
        }
    }

    func stop() async {
        listener?.cancel()
        listener = nil
    }

    private func handle(connection: NWConnection) {
        connection.start(queue: queue)

        Task {
            let response: LocalBridgeHTTPResponse
            do {
                let rawRequest = try await readRequest(from: connection)
                let request = try parseRequest(from: rawRequest)
                response = await handler(request)
            } catch {
                let envelope = FailureEnvelope(success: false, message: (error as NSError).localizedDescription)
                let body = (try? JSONEncoder().encode(envelope)) ?? Data("{}".utf8)
                response = LocalBridgeHTTPResponse(
                    statusCode: 400,
                    headers: ["Content-Type": "application/json; charset=utf-8"],
                    body: body
                )
            }

            try? await send(response: response, to: connection)
            connection.cancel()
        }
    }

    private func readRequest(from connection: NWConnection) async throws -> Data {
        var buffer = Data()
        let separator = Data("\r\n\r\n".utf8)
        var contentLength = 0

        while true {
            let chunk = try await receiveChunk(from: connection)
            buffer.append(chunk)

            if let range = buffer.range(of: separator) {
                if contentLength == 0 {
                    let headerData = buffer.subdata(in: 0..<range.lowerBound)
                    contentLength = contentLengthFromHeaderData(headerData)
                }

                let bodyStart = range.upperBound
                if buffer.count - bodyStart >= contentLength {
                    return buffer
                }
            }
        }
    }

    private func receiveChunk(from connection: NWConnection) async throws -> Data {
        try await withCheckedThrowingContinuation { continuation in
            connection.receive(minimumIncompleteLength: 1, maximumLength: 65_536) { data, _, isComplete, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }

                if let data, !data.isEmpty {
                    continuation.resume(returning: data)
                    return
                }

                if isComplete {
                    continuation.resume(throwing: HTTPServerError.connectionClosed)
                    return
                }

                continuation.resume(throwing: HTTPServerError.malformedRequest)
            }
        }
    }

    private func parseRequest(from data: Data) throws -> LocalBridgeHTTPRequest {
        let separator = Data("\r\n\r\n".utf8)
        guard let range = data.range(of: separator) else {
            throw HTTPServerError.malformedRequest
        }

        let headData = data.subdata(in: 0..<range.lowerBound)
        let body = data.subdata(in: range.upperBound..<data.count)
        guard let headText = String(data: headData, encoding: .utf8) else {
            throw HTTPServerError.malformedRequest
        }

        let lines = headText.components(separatedBy: "\r\n")
        guard let requestLine = lines.first else {
            throw HTTPServerError.malformedRequest
        }

        let requestParts = requestLine.components(separatedBy: " ")
        guard requestParts.count >= 2 else {
            throw HTTPServerError.malformedRequest
        }

        let headers = lines.dropFirst().reduce(into: [String: String]()) { partialResult, line in
            guard let separatorIndex = line.firstIndex(of: ":") else {
                return
            }
            let key = String(line[..<separatorIndex]).trimmingCharacters(in: .whitespacesAndNewlines)
            let value = String(line[line.index(after: separatorIndex)...]).trimmingCharacters(in: .whitespacesAndNewlines)
            partialResult[key] = value
        }

        return LocalBridgeHTTPRequest(
            method: requestParts[0],
            path: requestParts[1],
            headers: headers,
            body: body
        )
    }

    private func contentLengthFromHeaderData(_ data: Data) -> Int {
        guard let text = String(data: data, encoding: .utf8) else {
            return 0
        }

        for line in text.components(separatedBy: "\r\n") {
            let parts = line.components(separatedBy: ":")
            guard parts.count == 2,
                  parts[0].caseInsensitiveCompare("Content-Length") == .orderedSame else {
                continue
            }
            return Int(parts[1].trimmingCharacters(in: .whitespacesAndNewlines)) ?? 0
        }

        return 0
    }

    private func send(response: LocalBridgeHTTPResponse, to connection: NWConnection) async throws {
        var headers = response.headers
        headers["Content-Length"] = String(response.body.count)
        headers["Connection"] = "close"

        let headerLines = headers
            .map { "\($0.key): \($0.value)" }
            .sorted()
            .joined(separator: "\r\n")

        let statusLine = "HTTP/1.1 \(response.statusCode) \(reasonPhrase(for: response.statusCode))\r\n"
        var rawResponse = Data(statusLine.utf8)
        rawResponse.append(Data("\(headerLines)\r\n\r\n".utf8))
        rawResponse.append(response.body)

        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            connection.send(content: rawResponse, completion: .contentProcessed { error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume()
                }
            })
        }
    }

    private func reasonPhrase(for statusCode: Int) -> String {
        switch statusCode {
        case 200:
            return "OK"
        case 202:
            return "Accepted"
        case 204:
            return "No Content"
        case 400:
            return "Bad Request"
        case 403:
            return "Forbidden"
        case 404:
            return "Not Found"
        default:
            return "OK"
        }
    }
}
