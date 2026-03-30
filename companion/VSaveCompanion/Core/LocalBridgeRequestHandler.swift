import Foundation

struct LocalBridgeHTTPRequest: Equatable {
    let method: String
    let path: String
    let headers: [String: String]
    let body: Data
}

struct LocalBridgeHTTPResponse: Equatable {
    let statusCode: Int
    let headers: [String: String]
    let body: Data

    var bodyString: String {
        String(decoding: body, as: UTF8.self)
    }
}

@MainActor
final class LocalBridgeRequestHandler {
    private let store: LocalBridgeSessionStore
    private let logger: CompanionLogger
    private let validator: BackendOriginValidator
    private let onStartLogin: (LocalBridgeSession) async -> Void

    init(
        store: LocalBridgeSessionStore,
        logger: CompanionLogger,
        validator: BackendOriginValidator = BackendOriginValidator(),
        onStartLogin: @escaping (LocalBridgeSession) async -> Void
    ) {
        self.store = store
        self.logger = logger
        self.validator = validator
        self.onStartLogin = onStartLogin
    }

    func handle(_ request: LocalBridgeHTTPRequest) async -> LocalBridgeHTTPResponse {
        let requestOrigin = headerValue(named: "origin", in: request.headers)
        let backendOriginHeader = headerValue(
            named: CompanionConfig.localBridgeOriginHeader,
            in: request.headers
        )

        do {
            if request.method == "OPTIONS" {
                let requestedHeaders = headerValue(named: "access-control-request-headers", in: request.headers)
                guard isAllowedPreflightRequest(
                    requestOrigin: requestOrigin,
                    requestedHeaders: requestedHeaders
                ) else {
                    return jsonResponse(
                        statusCode: 403,
                        payload: FailureEnvelope(success: false, message: "不允许的来源"),
                        origin: requestOrigin
                    )
                }

                return emptyResponse(statusCode: 204, origin: requestOrigin)
            }

            if request.path == "/health", request.method == "GET" {
                guard isAllowedOriginRequest(
                    requestOrigin: requestOrigin,
                    backendOriginHeader: backendOriginHeader
                ) else {
                    return jsonResponse(
                        statusCode: 403,
                        payload: FailureEnvelope(success: false, message: "不允许的来源"),
                        origin: requestOrigin
                    )
                }

                let payload = LocalBridgeHealthResponse(
                    appName: CompanionConfig.appName,
                    healthy: true,
                    port: CompanionConfig.localBridgePort,
                    currentSession: store.getPublicSession()
                )
                return jsonResponse(
                    statusCode: 200,
                    payload: SuccessfulEnvelope(data: payload),
                    origin: requestOrigin
                )
            }

            if request.path == "/login/current", request.method == "GET" {
                guard isAllowedOriginRequest(
                    requestOrigin: requestOrigin,
                    backendOriginHeader: backendOriginHeader
                ) else {
                    return jsonResponse(
                        statusCode: 403,
                        payload: FailureEnvelope(success: false, message: "不允许的来源"),
                        origin: requestOrigin
                    )
                }

                return jsonResponse(
                    statusCode: 200,
                    payload: SuccessfulEnvelope(data: store.getPublicSession()),
                    origin: requestOrigin
                )
            }

            if request.path == "/login/start", request.method == "POST" {
                let body = try readJSONBody(StartLocalBridgeLoginRequest.self, from: request.body)
                guard isAllowedOriginRequest(
                    requestOrigin: requestOrigin,
                    backendOriginHeader: backendOriginHeader,
                    bodyBackendOrigin: body.backendOrigin
                ) else {
                    return jsonResponse(
                        statusCode: 403,
                        payload: FailureEnvelope(success: false, message: "不允许的来源"),
                        origin: requestOrigin
                    )
                }

                let session = createLocalBridgeSession(body)
                store.startSession(session)
                let response = jsonResponse(
                    statusCode: 202,
                    payload: SuccessfulEnvelope(data: store.getPublicSession()),
                    origin: requestOrigin
                )

                Task { [weak self] in
                    guard let self else { return }
                    await self.onStartLogin(session)
                }

                return response
            }

            return jsonResponse(
                statusCode: 404,
                payload: FailureEnvelope(success: false, message: "Not found"),
                origin: requestOrigin
            )
        } catch {
            let message = (error as NSError).localizedDescription
            logger.error("本机登录助手请求处理失败: \(message)")
            return jsonResponse(
                statusCode: 400,
                payload: FailureEnvelope(success: false, message: message),
                origin: requestOrigin
            )
        }
    }

    func isAllowedOriginRequest(
        requestOrigin: String,
        backendOriginHeader: String,
        bodyBackendOrigin: String? = nil
    ) -> Bool {
        let normalizedRequestOrigin = requestOrigin.trimmingCharacters(in: .whitespacesAndNewlines)
        guard validator.isAllowedLocalBridgeRequestOrigin(normalizedRequestOrigin) else {
            return false
        }

        let backendOrigins = [backendOriginHeader, bodyBackendOrigin ?? ""]
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }

        guard let baseline = backendOrigins.first else {
            return false
        }

        guard backendOrigins.allSatisfy({ $0 == baseline }) else {
            return false
        }

        return validator.isAllowedBackendOrigin(baseline)
    }

    func isAllowedPreflightRequest(
        requestOrigin: String,
        requestedHeaders: String
    ) -> Bool {
        let normalizedOrigin = requestOrigin.trimmingCharacters(in: .whitespacesAndNewlines)
        guard validator.isAllowedLocalBridgeRequestOrigin(normalizedOrigin) else {
            return false
        }

        let allowedHeaders = Set([
            "content-type",
            CompanionConfig.localBridgeOriginHeader.lowercased(),
        ])

        let requestedHeaderList = requestedHeaders
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
            .filter { !$0.isEmpty }

        return requestedHeaderList.allSatisfy { allowedHeaders.contains($0) }
    }

    private func readJSONBody<T: Decodable>(_ type: T.Type, from body: Data) throws -> T {
        let trimmed = String(decoding: body, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw NSError(
                domain: CompanionConfig.appName,
                code: 11,
                userInfo: [NSLocalizedDescriptionKey: "缺少请求体"]
            )
        }

        return try JSONDecoder().decode(T.self, from: Data(trimmed.utf8))
    }

    private func jsonResponse<T: Encodable>(
        statusCode: Int,
        payload: T,
        origin: String
    ) -> LocalBridgeHTTPResponse {
        let encoded = (try? JSONEncoder().encode(payload)) ?? Data("{}".utf8)
        return LocalBridgeHTTPResponse(
            statusCode: statusCode,
            headers: corsHeaders(for: origin, extra: [
                "Content-Type": "application/json; charset=utf-8",
            ]),
            body: encoded
        )
    }

    private func emptyResponse(statusCode: Int, origin: String) -> LocalBridgeHTTPResponse {
        LocalBridgeHTTPResponse(
            statusCode: statusCode,
            headers: corsHeaders(for: origin, extra: [:]),
            body: Data()
        )
    }

    private func corsHeaders(for origin: String, extra: [String: String]) -> [String: String] {
        guard !origin.isEmpty else {
            return extra
        }

        var headers = extra
        headers["Access-Control-Allow-Origin"] = origin
        headers["Access-Control-Allow-Headers"] = "Content-Type, \(CompanionConfig.localBridgeOriginHeader)"
        headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS"
        return headers
    }

    private func headerValue(named name: String, in headers: [String: String]) -> String {
        headers.first(where: { $0.key.caseInsensitiveCompare(name) == .orderedSame })?.value ?? ""
    }
}
