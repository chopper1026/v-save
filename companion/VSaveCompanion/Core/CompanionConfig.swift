import Foundation

enum CompanionConfig {
    static let appName = "V-SAVE Companion"
    static let launchAgentLabel = "com.vsave.companion.launch-agent"
    static let localBridgeHost = "127.0.0.1"
    static let localBridgePort = 37219
    static let localBridgeOriginHeader = "x-vsave-backend-origin"
    static let douyinLoginURL = "https://www.douyin.com/"
    static let loginWatchTimeoutSeconds: TimeInterval = 5 * 60
    static let chromeCandidatePaths = [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    ]

    static var bridgeServerAddress: String {
        "http://\(localBridgeHost):\(localBridgePort)"
    }

    static var chromeProfileDisplayPath: String {
        "~/Library/Application Support/\(appName)/chrome-profiles/<session-id>"
    }

    static func chromeProfileURL(fileManager: FileManager = .default) -> URL {
        chromeProfilesDirectory(fileManager: fileManager)
            .appendingPathComponent(UUID().uuidString.lowercased(), isDirectory: true)
    }

    static func chromeProfilesDirectory(fileManager: FileManager = .default) -> URL {
        applicationSupportDirectory(fileManager: fileManager)
            .appendingPathComponent("chrome-profiles", isDirectory: true)
    }

    static func applicationSupportDirectory(fileManager: FileManager = .default) -> URL {
        let root = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return root.appendingPathComponent(appName, isDirectory: true)
    }

    static func logsDirectory(fileManager: FileManager = .default) -> URL {
        let home = fileManager.homeDirectoryForCurrentUser
        return home
            .appendingPathComponent("Library", isDirectory: true)
            .appendingPathComponent("Logs", isDirectory: true)
            .appendingPathComponent(appName, isDirectory: true)
    }

    static func launchAgentsDirectory(fileManager: FileManager = .default) -> URL {
        fileManager.homeDirectoryForCurrentUser
            .appendingPathComponent("Library", isDirectory: true)
            .appendingPathComponent("LaunchAgents", isDirectory: true)
    }

    static func launchAgentPlistURL(fileManager: FileManager = .default) -> URL {
        launchAgentsDirectory(fileManager: fileManager)
            .appendingPathComponent("\(launchAgentLabel).plist", isDirectory: false)
    }
}

struct BackendOriginValidator {
    private let explicitAllowlist: Set<String>
    private let configuredOriginProvider: () -> String?

    init(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        configuredOriginProvider: @escaping () -> String? = { nil }
    ) {
        let raw = environment["V_SAVE_ALLOWED_BACKEND_ORIGINS"] ?? ""
        let values = raw
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .compactMap { CompanionConfig.normalizedOriginURL($0)?.absoluteString }
            .filter { !$0.isEmpty }
        self.explicitAllowlist = Set(values)
        self.configuredOriginProvider = configuredOriginProvider
    }

    func isAllowedBackendOrigin(_ origin: String) -> Bool {
        guard let parsed = CompanionConfig.normalizedOriginURL(origin) else {
            return false
        }

        if let configuredOrigin = normalizedConfiguredOrigin(),
           configuredOrigin.absoluteString == parsed.absoluteString {
            return true
        }

        if !explicitAllowlist.isEmpty {
            return explicitAllowlist.contains(parsed.absoluteString)
        }

        return isTrustedOrigin(parsed)
    }

    func isAllowedLocalBridgeRequestOrigin(_ origin: String) -> Bool {
        guard let parsed = CompanionConfig.normalizedOriginURL(origin) else {
            return false
        }

        if let configuredOrigin = normalizedConfiguredOrigin(),
           configuredOrigin.absoluteString == parsed.absoluteString {
            return true
        }

        return isTrustedOrigin(parsed)
    }

    private func normalizedConfiguredOrigin() -> URL? {
        CompanionConfig.normalizedOriginURL(configuredOriginProvider() ?? "")
    }

    private func isTrustedOrigin(_ url: URL) -> Bool {
        let host = (url.host ?? "").lowercased()
        if url.scheme == "https" {
            return true
        }

        return host == "localhost" || host == "127.0.0.1" || host == "::1"
    }
}

extension CompanionConfig {
    static func normalizedOriginURL(_ value: String) -> URL? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let url = URL(string: trimmed), let scheme = url.scheme, let host = url.host else {
            return nil
        }

        guard scheme.caseInsensitiveCompare("http") == .orderedSame
            || scheme.caseInsensitiveCompare("https") == .orderedSame else {
            return nil
        }

        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        components?.scheme = scheme.lowercased()
        components?.host = host.lowercased()
        components?.path = ""
        components?.query = nil
        components?.fragment = nil
        return components?.url
    }
}
