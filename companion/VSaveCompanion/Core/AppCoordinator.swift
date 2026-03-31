import AppKit
import Foundation

@MainActor
final class CompanionAppCoordinator {
    private let logger: CompanionLogger
    private let sessionStore: LocalBridgeSessionStore
    private let runtimeStore: CompanionRuntimeStore
    private let adminPageOriginController: AdminPageOriginController
    private let openAtLoginController: OpenAtLoginController
    private let serverSyncClient: CompanionServerSyncClient
    private let statusBarManager: StatusBarManager
    private var localBridgeServer: LocalBridgeServer?
    private var currentChrome: LaunchedChrome?
    private var activeLoginTask: Task<Void, Never>?
    private var activeLoginToken: UUID?
    private var restartTask: Task<Void, Never>?
    private var chromeExecutablePath: String?

    init(
        logger: CompanionLogger = CompanionLogger(),
        sessionStore: LocalBridgeSessionStore = LocalBridgeSessionStore(),
        runtimeStore: CompanionRuntimeStore? = nil,
        adminPageOriginController: AdminPageOriginController = AdminPageOriginController(),
        openAtLoginController: OpenAtLoginController = OpenAtLoginController(),
        serverSyncClient: CompanionServerSyncClient = CompanionServerSyncClient(),
        statusBarManager: StatusBarManager = StatusBarManager(),
        appVersion: String = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0.0"
    ) {
        self.logger = logger
        self.sessionStore = sessionStore
        self.runtimeStore = runtimeStore ?? CompanionRuntimeStore(appVersion: appVersion)
        self.adminPageOriginController = adminPageOriginController
        self.openAtLoginController = openAtLoginController
        self.serverSyncClient = serverSyncClient
        self.statusBarManager = statusBarManager

        _ = self.runtimeStore.subscribe { [weak self] snapshot in
            self?.statusBarManager.update(snapshot: snapshot)
        }

        _ = self.sessionStore.subscribe { [weak self] session in
            guard let self else { return }
            self.runtimeStore.setCurrentSession(session?.publicSession)
            self.runtimeStore.setLastError(session?.lastError)
        }
    }

    func start() async {
        statusBarManager.configure(
            snapshotProvider: { [weak self] in
                self?.runtimeStore.snapshot ?? CompanionRuntimeSnapshot(
                    appVersion: "1.0.0",
                    lastRestartAt: ISO8601Timestamp.now(),
                    serverStatus: "stopped",
                    serverAddress: nil,
                    adminPageOrigin: nil,
                    chromeStatus: "idle",
                    currentSession: nil,
                    lastError: nil,
                    openAtLoginEnabled: false,
                    openAtLoginError: nil
                )
            },
            actionHandler: { [weak self] action in
                self?.handleStatusBarAction(action)
            }
        )

        let openAtLoginState = openAtLoginController.initialize()
        runtimeStore.setAdminPageOrigin(adminPageOriginController.currentOrigin())
        runtimeStore.setOpenAtLogin(
            enabled: openAtLoginState.enabled,
            error: openAtLoginState.lastError
        )
        _ = ensureChromeAvailability(captureError: true)
        await startLocalBridgeRuntime()
    }

    func shutdown() async {
        activeLoginToken = nil
        activeLoginTask?.cancel()
        activeLoginTask = nil
        await cleanupChrome()
        await stopLocalBridgeRuntime()
        statusBarManager.destroy()
    }

    private func handleStatusBarAction(_ action: StatusBarAction) {
        switch action {
        case .configureAdminPageOrigin:
            configureAdminPageOrigin()

        case .toggleOpenAtLogin:
            Task {
                let desiredEnabled = !runtimeStore.snapshot.openAtLoginEnabled
                let state = openAtLoginController.setEnabled(desiredEnabled)
                await MainActor.run {
                    runtimeStore.setOpenAtLogin(enabled: state.enabled, error: state.lastError)
                    if let error = state.lastError {
                        logger.error("更新开机自启失败: \(error)")
                    }
                }
            }

        case .restartHelper:
            restartHelper()

        case .quitApp:
            Task {
                await shutdown()
                NSApplication.shared.terminate(nil)
            }
        }
    }

    private func ensureChromeAvailability(captureError: Bool = false) -> String? {
        do {
            chromeExecutablePath = try ChromeLocator.pickExecutablePath()
            runtimeStore.setChromeStatus("ready")
            return chromeExecutablePath
        } catch {
            chromeExecutablePath = nil
            runtimeStore.setChromeStatus("idle")
            if captureError {
                runtimeStore.setLastError((error as NSError).localizedDescription)
            }
            return nil
        }
    }

    private func cleanupChrome() async {
        let chrome = currentChrome
        currentChrome = nil
        if let chrome {
            await chrome.stop()
            do {
                if FileManager.default.fileExists(atPath: chrome.userDataURL.path) {
                    try FileManager.default.removeItem(at: chrome.userDataURL)
                }
            } catch {
                logger.error("清理临时 Chrome Profile 失败: \((error as NSError).localizedDescription)")
            }
        }
        _ = ensureChromeAvailability()
    }

    private func beginLoginFlow(for session: LocalBridgeSession) async {
        activeLoginToken = nil
        activeLoginTask?.cancel()
        activeLoginTask = nil
        await cleanupChrome()

        let token = UUID()
        activeLoginToken = token
        activeLoginTask = Task { [weak self] in
            await self?.performLoginFlow(session, token: token)
        }
    }

    private func performLoginFlow(_ session: LocalBridgeSession, token: UUID) async {
        runtimeStore.setLastError(nil)

        do {
            sessionStore.updateStatus(authSessionId: session.authSessionId, status: .browserOpened)

            guard let executablePath = chromeExecutablePath ?? ensureChromeAvailability(captureError: true) else {
                throw NSError(
                    domain: CompanionConfig.appName,
                    code: 12,
                    userInfo: [NSLocalizedDescriptionKey: "未检测到可用的 Google Chrome，请先安装后重试"]
                )
            }

            runtimeStore.setChromeStatus("starting")
            let launched = try ChromeLauncher.launch(
                executablePath: executablePath,
                userDataURL: CompanionConfig.chromeProfileURL(),
                loginURL: session.loginUrl.isEmpty ? CompanionConfig.douyinLoginURL : session.loginUrl
            )
            currentChrome = launched

            sessionStore.updateChromeRuntime(
                authSessionId: session.authSessionId,
                metadata: ChromeRuntimeMetadata(
                    chromeDebugPort: launched.remoteDebuggingPort,
                    chromePid: launched.process.processIdentifier
                )
            )

            _ = try await ChromeLauncher.waitForDebuggingEndpoint(
                remoteDebuggingPort: launched.remoteDebuggingPort
            )
            try Task.checkCancellation()

            runtimeStore.setChromeStatus("connected")
            sessionStore.updateStatus(authSessionId: session.authSessionId, status: .waitingScan)

            let cookieHeader = try await DouyinCookieCollector.waitForLoginCookie(
                remoteDebuggingPort: launched.remoteDebuggingPort
            )
            try Task.checkCancellation()

            sessionStore.updateStatus(authSessionId: session.authSessionId, status: .uploading)
            _ = try await serverSyncClient.completeBridgeAuth(
                payload: CompleteBridgeAuthRequest(
                    authSessionId: session.authSessionId,
                    uploadToken: session.uploadToken,
                    cookieHeader: cookieHeader
                ),
                backendOrigin: session.backendOrigin
            )

            sessionStore.updateStatus(authSessionId: session.authSessionId, status: .confirmed)
            runtimeStore.setLastError(nil)
            logger.info("抖音登录回传成功: authSessionId=\(session.authSessionId)")
        } catch is CancellationError {
            // Replaced or interrupted.
        } catch {
            if activeLoginToken == token {
                let message = (error as NSError).localizedDescription
                sessionStore.updateStatus(
                    authSessionId: session.authSessionId,
                    status: .failed,
                    lastError: message
                )
                runtimeStore.setLastError(message)
                logger.error("抖音登录桥接失败: \(message)")
            }
        }

        if activeLoginToken == token {
            activeLoginToken = nil
            activeLoginTask = nil
        }

        await cleanupChrome()
    }

    private func createLocalBridgeRuntime() -> LocalBridgeServer {
        let requestHandler = LocalBridgeRequestHandler(
            store: sessionStore,
            logger: logger,
            validator: BackendOriginValidator(
                configuredOriginProvider: { [weak self] in
                    self?.adminPageOriginController.currentOrigin()
                }
            ),
            onStartLogin: { [weak self] session in
                guard let self else { return }
                await self.beginLoginFlow(for: session)
            }
        )
        return LocalBridgeServer(requestHandler: requestHandler, logger: logger)
    }

    private func startLocalBridgeRuntime() async {
        if localBridgeServer != nil {
            runtimeStore.setServerStatus("running", serverAddress: CompanionConfig.bridgeServerAddress)
            return
        }

        runtimeStore.setServerStatus("starting", serverAddress: CompanionConfig.bridgeServerAddress)
        let server = createLocalBridgeRuntime()
        localBridgeServer = server

        do {
            try await server.start()
            runtimeStore.setServerStatus("running", serverAddress: CompanionConfig.bridgeServerAddress)
        } catch {
            localBridgeServer = nil
            let message = (error as NSError).localizedDescription
            runtimeStore.setServerStatus("error", serverAddress: CompanionConfig.bridgeServerAddress)
            runtimeStore.setLastError(message)
            logger.error("启动本机登录助手失败: \(message)")
        }
    }

    private func stopLocalBridgeRuntime() async {
        guard let localBridgeServer else {
            runtimeStore.setServerStatus("stopped", serverAddress: CompanionConfig.bridgeServerAddress)
            return
        }

        await localBridgeServer.stop()
        self.localBridgeServer = nil
        runtimeStore.setServerStatus("stopped", serverAddress: CompanionConfig.bridgeServerAddress)
    }

    private func restartHelper() {
        guard restartTask == nil else {
            return
        }

        restartTask = Task { [weak self] in
            guard let self else { return }
            self.logger.info("收到重启本机登录助手请求")
            self.sessionStore.clearCurrentSession()
            self.activeLoginToken = nil
            self.activeLoginTask?.cancel()
            self.activeLoginTask = nil
            await self.cleanupChrome()
            await self.stopLocalBridgeRuntime()
            self.runtimeStore.resetOnRestart()
            _ = self.ensureChromeAvailability(captureError: true)
            await self.startLocalBridgeRuntime()
            self.logger.info("本机登录助手已重启")
            self.restartTask = nil
        }
    }

    private func configureAdminPageOrigin() {
        let alert = NSAlert()
        alert.alertStyle = .informational
        alert.messageText = "设置管理端页面地址"
        alert.informativeText = "请输入你在浏览器里打开的 V-SAVE 管理端页面地址。留空可恢复默认来源规则。"
        alert.addButton(withTitle: "保存")
        alert.addButton(withTitle: "取消")

        let textField = NSTextField(frame: NSRect(x: 0, y: 0, width: 320, height: 24))
        textField.placeholderString = "http://admin.example.com"
        textField.stringValue = adminPageOriginController.currentOrigin() ?? ""
        alert.accessoryView = textField

        let response = alert.runModal()
        guard response == .alertFirstButtonReturn else {
            return
        }

        let state = adminPageOriginController.setOrigin(textField.stringValue)
        if let error = state.lastError {
            logger.error("保存管理端页面地址失败: \(error)")
            showAdminPageOriginSaveError(error)
            return
        }

        runtimeStore.setAdminPageOrigin(state.origin)
        logger.info("管理端页面地址已更新: \(state.origin ?? "未设置")")
    }

    private func showAdminPageOriginSaveError(_ message: String) {
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "保存管理端页面地址失败"
        alert.informativeText = message
        alert.addButton(withTitle: "确定")
        alert.runModal()
    }
}
