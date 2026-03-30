import Foundation

@MainActor
final class CompanionRuntimeStore {
    private var subscribers: [UUID: (CompanionRuntimeSnapshot) -> Void] = [:]
    private var snapshotValue: CompanionRuntimeSnapshot

    init(appVersion: String, now: Date = Date()) {
        self.snapshotValue = CompanionRuntimeSnapshot(
            appVersion: appVersion.trimmingCharacters(in: .whitespacesAndNewlines),
            lastRestartAt: ISO8601Timestamp.now(date: now),
            serverStatus: "stopped",
            serverAddress: nil,
            chromeStatus: "idle",
            currentSession: nil,
            lastError: nil,
            openAtLoginEnabled: false,
            openAtLoginError: nil
        )
    }

    var snapshot: CompanionRuntimeSnapshot {
        snapshotValue
    }

    func subscribe(_ listener: @escaping (CompanionRuntimeSnapshot) -> Void) -> UUID {
        let id = UUID()
        subscribers[id] = listener
        return id
    }

    func unsubscribe(_ id: UUID) {
        subscribers.removeValue(forKey: id)
    }

    func setServerStatus(_ status: String, serverAddress: String? = nil) {
        snapshotValue.serverStatus = normalize(status, fallback: "stopped")
        snapshotValue.serverAddress = normalizedOptional(serverAddress)
        notify()
    }

    func setChromeStatus(_ status: String) {
        snapshotValue.chromeStatus = normalize(status, fallback: "idle")
        notify()
    }

    func setCurrentSession(_ session: PublicLocalBridgeSession?) {
        snapshotValue.currentSession = session
        notify()
    }

    func setLastError(_ error: String?) {
        snapshotValue.lastError = normalizedOptional(error)
        notify()
    }

    func setOpenAtLogin(enabled: Bool, error: String? = nil) {
        snapshotValue.openAtLoginEnabled = enabled
        snapshotValue.openAtLoginError = normalizedOptional(error)
        notify()
    }

    func resetOnRestart(now: Date = Date()) {
        snapshotValue.lastRestartAt = ISO8601Timestamp.now(date: now)
        snapshotValue.serverStatus = "stopped"
        snapshotValue.serverAddress = nil
        snapshotValue.chromeStatus = "idle"
        snapshotValue.currentSession = nil
        snapshotValue.lastError = nil
        snapshotValue.openAtLoginError = nil
        notify()
    }

    private func notify() {
        let snapshot = snapshotValue
        subscribers.values.forEach { $0(snapshot) }
    }

    private func normalize(_ value: String, fallback: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? fallback : trimmed
    }

    private func normalizedOptional(_ value: String?) -> String? {
        guard let value else {
            return nil
        }

        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
