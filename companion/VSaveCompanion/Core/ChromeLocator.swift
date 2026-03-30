import Foundation

enum ChromeLocatorError: LocalizedError {
    case executableNotFound

    var errorDescription: String? {
        "未找到可用的 Google Chrome，请先安装 Chrome 后再启动本机登录助手"
    }
}

enum ChromeLocator {
    static func pickExecutablePath(
        candidates: [String] = CompanionConfig.chromeCandidatePaths,
        fileExists: (String) -> Bool = { FileManager.default.isExecutableFile(atPath: $0) }
    ) throws -> String {
        if let executable = candidates.first(where: fileExists) {
            return executable
        }

        throw ChromeLocatorError.executableNotFound
    }
}
