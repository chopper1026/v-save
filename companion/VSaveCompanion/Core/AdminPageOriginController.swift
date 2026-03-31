import Foundation

struct AdminPageOriginPreferences: Codable, Equatable {
    var adminPageOrigin: String?
}

struct AdminPageOriginState: Equatable {
    let origin: String?
    let lastError: String?
}

final class AdminPageOriginController {
    private let fileManager: FileManager
    private let preferencesURL: URL

    init(
        fileManager: FileManager = .default,
        preferencesURL: URL? = nil
    ) {
        self.fileManager = fileManager
        self.preferencesURL = preferencesURL
            ?? CompanionConfig.applicationSupportDirectory(fileManager: fileManager)
            .appendingPathComponent("admin-page-origin-settings.json", isDirectory: false)
    }

    func currentOrigin() -> String? {
        readPreferences().adminPageOrigin
    }

    func setOrigin(_ value: String) -> AdminPageOriginState {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            return persist(origin: nil)
        }

        guard let normalized = CompanionConfig.normalizedOriginURL(trimmed)?.absoluteString else {
            return AdminPageOriginState(
                origin: currentOrigin(),
                lastError: "请输入完整的管理端页面地址，例如 http://115.190.228.9 或 https://admin.example.com"
            )
        }

        return persist(origin: normalized)
    }

    private func readPreferences() -> AdminPageOriginPreferences {
        guard let data = try? Data(contentsOf: preferencesURL),
              let preferences = try? JSONDecoder().decode(AdminPageOriginPreferences.self, from: data) else {
            return AdminPageOriginPreferences(adminPageOrigin: nil)
        }

        return preferences
    }

    private func persist(origin: String?) -> AdminPageOriginState {
        let preferences = AdminPageOriginPreferences(adminPageOrigin: origin)

        do {
            try fileManager.createDirectory(
                at: preferencesURL.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            let data = try JSONEncoder().encode(preferences)
            try data.write(to: preferencesURL, options: .atomic)
            return AdminPageOriginState(origin: origin, lastError: nil)
        } catch {
            let message = (error as NSError).localizedDescription.trimmingCharacters(in: .whitespacesAndNewlines)
            return AdminPageOriginState(
                origin: currentOrigin(),
                lastError: message.isEmpty ? "保存管理端页面地址失败" : message
            )
        }
    }
}
