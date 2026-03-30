import Foundation
import ServiceManagement

protocol LoginItemManaging {
    func isEnabled() -> Bool
    func setEnabled(_ enabled: Bool) throws
}

struct LaunchAgentLoginItemManager: LoginItemManaging {
    private let fileManager: FileManager
    private let plistURL: URL
    private let executablePath: String?

    init(
        fileManager: FileManager = .default,
        plistURL: URL? = nil,
        executablePath: String? = Bundle.main.executableURL?.path
    ) {
        self.fileManager = fileManager
        self.plistURL = plistURL ?? CompanionConfig.launchAgentPlistURL(fileManager: fileManager)
        self.executablePath = executablePath
    }

    func isEnabled() -> Bool {
        fileManager.fileExists(atPath: plistURL.path)
    }

    func setEnabled(_ enabled: Bool) throws {
        if enabled {
            try writeLaunchAgentPlist()
            return
        }

        guard fileManager.fileExists(atPath: plistURL.path) else {
            return
        }

        try fileManager.removeItem(at: plistURL)
    }

    private func writeLaunchAgentPlist() throws {
        let executablePath = (executablePath ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !executablePath.isEmpty else {
            throw NSError(
                domain: CompanionConfig.appName,
                code: 2,
                userInfo: [NSLocalizedDescriptionKey: "未找到当前 Companion 可执行文件，无法设置开机自启"]
            )
        }

        let plist: [String: Any] = [
            "Label": CompanionConfig.launchAgentLabel,
            "ProgramArguments": [executablePath],
            "RunAtLoad": true,
        ]

        let data = try PropertyListSerialization.data(fromPropertyList: plist, format: .xml, options: 0)
        try fileManager.createDirectory(
            at: plistURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try data.write(to: plistURL, options: .atomic)
    }
}

struct OpenAtLoginPreferences: Codable, Equatable {
    var initialized: Bool
    var openAtLoginEnabled: Bool

    static let `default` = OpenAtLoginPreferences(
        initialized: false,
        openAtLoginEnabled: false
    )
}

struct OpenAtLoginState: Equatable {
    let enabled: Bool
    let lastError: String?
}

struct ServiceManagementLoginItemManager: LoginItemManaging {
    func isEnabled() -> Bool {
        if #available(macOS 13.0, *) {
            return SMAppService.mainApp.status == .enabled
        }

        return false
    }

    func setEnabled(_ enabled: Bool) throws {
        if #available(macOS 13.0, *) {
            if enabled {
                try SMAppService.mainApp.register()
            } else {
                try SMAppService.mainApp.unregister()
            }
            return
        }

        throw NSError(
            domain: CompanionConfig.appName,
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: "当前 macOS 版本不支持开机自启设置"]
        )
    }
}

final class OpenAtLoginController {
    private let loginItemManager: LoginItemManaging
    private let fileManager: FileManager
    private let preferencesURL: URL

    init(
        loginItemManager: LoginItemManaging = LaunchAgentLoginItemManager(),
        fileManager: FileManager = .default,
        preferencesURL: URL? = nil
    ) {
        self.loginItemManager = loginItemManager
        self.fileManager = fileManager
        self.preferencesURL = preferencesURL
            ?? CompanionConfig.applicationSupportDirectory(fileManager: fileManager)
            .appendingPathComponent("open-at-login-settings.json", isDirectory: false)
    }

    func initialize() -> OpenAtLoginState {
        let preferences = readPreferences()
        let desiredEnabled = preferences.initialized ? preferences.openAtLoginEnabled : true
        return applyEnabledState(desiredEnabled)
    }

    func setEnabled(_ enabled: Bool) -> OpenAtLoginState {
        applyEnabledState(enabled)
    }

    private func applyEnabledState(_ enabled: Bool) -> OpenAtLoginState {
        do {
            try loginItemManager.setEnabled(enabled)
            writePreferences(.init(initialized: true, openAtLoginEnabled: enabled))
            return OpenAtLoginState(enabled: loginItemManager.isEnabled(), lastError: nil)
        } catch {
            return OpenAtLoginState(
                enabled: loginItemManager.isEnabled(),
                lastError: normalizeErrorMessage(error)
            )
        }
    }

    private func readPreferences() -> OpenAtLoginPreferences {
        guard let data = try? Data(contentsOf: preferencesURL),
              let preferences = try? JSONDecoder().decode(OpenAtLoginPreferences.self, from: data) else {
            return .default
        }

        return preferences
    }

    private func writePreferences(_ preferences: OpenAtLoginPreferences) {
        try? fileManager.createDirectory(
            at: preferencesURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        guard let data = try? JSONEncoder().encode(preferences) else {
            return
        }
        try? data.write(to: preferencesURL, options: .atomic)
    }

    private func normalizeErrorMessage(_ error: Error) -> String {
        let nsError = error as NSError
        let message = nsError.localizedDescription.trimmingCharacters(in: .whitespacesAndNewlines)
        return message.isEmpty ? "设置开机自启失败" : message
    }
}
