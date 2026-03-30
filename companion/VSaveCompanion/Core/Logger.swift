import Foundation

final class CompanionLogger {
    private let fileManager: FileManager
    private let logFileURL: URL

    init(fileManager: FileManager = .default) {
        self.fileManager = fileManager
        let logsDirectory = CompanionConfig.logsDirectory(fileManager: fileManager)
        try? fileManager.createDirectory(at: logsDirectory, withIntermediateDirectories: true)
        self.logFileURL = logsDirectory.appendingPathComponent("bridge.log", isDirectory: false)
    }

    func info(_ message: String) {
        write(level: "INFO", message: message)
    }

    func warn(_ message: String) {
        write(level: "WARN", message: message)
    }

    func error(_ message: String) {
        write(level: "ERROR", message: message)
    }

    private func write(level: String, message: String) {
        let line = "[\(ISO8601Timestamp.now())] \(level) \(message)\n"
        guard let data = line.data(using: .utf8) else {
            return
        }

        if fileManager.fileExists(atPath: logFileURL.path),
           let handle = try? FileHandle(forWritingTo: logFileURL) {
            defer { try? handle.close() }
            _ = try? handle.seekToEnd()
            try? handle.write(contentsOf: data)
        } else {
            try? data.write(to: logFileURL, options: .atomic)
        }

        fputs(line, stdout)
    }
}
