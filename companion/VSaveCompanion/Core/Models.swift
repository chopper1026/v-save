import Foundation

enum LocalBridgeSessionStatus: String, Codable, Equatable {
    case waitingHelper = "waiting_helper"
    case browserOpened = "browser_opened"
    case waitingScan = "waiting_scan"
    case scanned = "scanned"
    case uploading = "uploading"
    case confirmed = "confirmed"
    case failed = "failed"
    case expired = "expired"
}

struct StartLocalBridgeLoginRequest: Codable, Equatable {
    let authSessionId: String
    let uploadToken: String
    let expiresAt: String
    let loginUrl: String
    let backendOrigin: String
}

struct ChromeRuntimeMetadata: Codable, Equatable {
    let chromeDebugPort: Int?
    let chromePid: Int32?
}

struct LocalBridgeSession: Codable, Equatable {
    let authSessionId: String
    let uploadToken: String
    let backendOrigin: String
    let expiresAt: String
    let loginUrl: String
    var status: LocalBridgeSessionStatus
    let startedAt: String
    var completedAt: String?
    var lastError: String?
    var chromeDebugPort: Int?
    var chromePid: Int32?

    var publicSession: PublicLocalBridgeSession {
        PublicLocalBridgeSession(
            authSessionId: authSessionId,
            backendOrigin: backendOrigin,
            expiresAt: expiresAt,
            loginUrl: loginUrl,
            status: status,
            startedAt: startedAt,
            completedAt: completedAt,
            lastError: lastError,
            chromeDebugPort: chromeDebugPort,
            chromePid: chromePid
        )
    }
}

struct PublicLocalBridgeSession: Codable, Equatable {
    let authSessionId: String
    let backendOrigin: String
    let expiresAt: String
    let loginUrl: String
    let status: LocalBridgeSessionStatus
    let startedAt: String
    let completedAt: String?
    let lastError: String?
    let chromeDebugPort: Int?
    let chromePid: Int32?
}

struct LocalBridgeHealthResponse: Codable, Equatable {
    let appName: String
    let healthy: Bool
    let port: Int
    let currentSession: PublicLocalBridgeSession?
}

struct CompleteBridgeAuthRequest: Codable, Equatable {
    let authSessionId: String
    let uploadToken: String
    let cookieHeader: String
}

struct CompleteBridgeAuthResponse: Codable, Equatable {
    let authSessionId: String
    let status: String
    let completedAt: String
}

struct SuccessfulEnvelope<T: Codable & Equatable>: Codable, Equatable {
    let success: Bool
    let data: T

    init(data: T) {
        self.success = true
        self.data = data
    }
}

struct FailureEnvelope: Codable, Equatable {
    let success: Bool
    let message: String
}

struct CompanionRuntimeSnapshot: Equatable {
    var appVersion: String
    var lastRestartAt: String
    var serverStatus: String
    var serverAddress: String?
    var adminPageOrigin: String?
    var chromeStatus: String
    var currentSession: PublicLocalBridgeSession?
    var lastError: String?
    var openAtLoginEnabled: Bool
    var openAtLoginError: String?
}

struct StatusPanelSnapshot: Equatable {
    var appVersion: String
    var helperStatus: String
    var helperTone: StatusTone
    var serverAddress: String
    var adminPageOrigin: String?
    var chromeStatus: String
    var currentSessionId: String
    var currentSessionStatus: String
    var currentSessionExpiresAt: String
    var lastError: String?
    var openAtLoginEnabled: Bool
    var openAtLoginError: String?
    var lastRestartAt: String
}

enum StatusTone: Equatable {
    case neutral
    case success
    case warning
    case danger
}

enum StatusBarAction: Equatable {
    case configureAdminPageOrigin
    case toggleOpenAtLogin
    case restartHelper
    case quitApp

    var menuItemIdentifier: String {
        switch self {
        case .configureAdminPageOrigin:
            return "configure-admin-page-origin"
        case .toggleOpenAtLogin:
            return "toggle-open-at-login"
        case .restartHelper:
            return "restart-helper"
        case .quitApp:
            return "quit-app"
        }
    }
}

struct ChromeCookieCandidate: Codable, Equatable {
    let name: String
    let value: String
    let domain: String
}

enum ISO8601Timestamp {
    nonisolated(unsafe) private static let formatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    static func now(date: Date = Date()) -> String {
        formatter.string(from: date)
    }

    static func parse(_ value: String) -> Date? {
        formatter.date(from: value)
    }
}

func createLocalBridgeSession(_ input: StartLocalBridgeLoginRequest, now: Date = Date()) -> LocalBridgeSession {
    LocalBridgeSession(
        authSessionId: input.authSessionId.trimmingCharacters(in: .whitespacesAndNewlines),
        uploadToken: input.uploadToken.trimmingCharacters(in: .whitespacesAndNewlines),
        backendOrigin: input.backendOrigin.trimmingCharacters(in: .whitespacesAndNewlines),
        expiresAt: input.expiresAt.trimmingCharacters(in: .whitespacesAndNewlines),
        loginUrl: input.loginUrl.trimmingCharacters(in: .whitespacesAndNewlines),
        status: .waitingHelper,
        startedAt: ISO8601Timestamp.now(date: now),
        completedAt: nil,
        lastError: nil,
        chromeDebugPort: nil,
        chromePid: nil
    )
}
