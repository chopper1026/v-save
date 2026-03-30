import Foundation

@MainActor
final class LocalBridgeServer {
    private let logger: CompanionLogger
    private let requestHandler: LocalBridgeRequestHandler
    private var server: HTTPServer?

    init(
        requestHandler: LocalBridgeRequestHandler,
        logger: CompanionLogger
    ) {
        self.requestHandler = requestHandler
        self.logger = logger
    }

    func start() async throws {
        guard server == nil else {
            return
        }

        let server = HTTPServer(
            host: CompanionConfig.localBridgeHost,
            port: UInt16(CompanionConfig.localBridgePort)
        ) { [requestHandler] request in
            await requestHandler.handle(request)
        }

        try await server.start()
        self.server = server
        logger.info("本机登录助手监听中: \(CompanionConfig.bridgeServerAddress)")
    }

    func stop() async {
        guard let server else {
            return
        }

        await server.stop()
        self.server = nil
    }
}
