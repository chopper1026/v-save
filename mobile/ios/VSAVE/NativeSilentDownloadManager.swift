import Foundation
import Photos
import React
import Security
import UIKit
import UserNotifications

private let nativeSilentDownloadSnapshotStorageKey = "vsave-native-silent-download-snapshot"
private let nativeSilentDownloadConfigStorageKey = "vsave-native-silent-download-config"
private let nativeSilentDownloadAuthTokenService = "com.vsave.mobile.native-silent-download"
private let nativeSilentDownloadAuthTokenAccount = "auth-token"
private let nativeSilentDownloadFinishedLimit = 20

private enum NativeSilentDownloadStatus: String, Codable {
  case queued
  case preparing
  case downloading
  case saving
  case completed
  case failed
}

private struct NativeSilentDownloadTask: Codable {
  var id: String
  var sourceUrl: String
  var dedupeKey: String
  var status: NativeSilentDownloadStatus
  var progress: Int
  var createdAt: Double
  var updatedAt: Double
  var startedAt: Double?
  var finishedAt: Double?
  var title: String?
  var platform: String?
  var quality: String?
  var runtimeTraceId: String?
  var errorMessage: String?
  var retryCount: Int?
  var nativeTaskIdentifier: Int?
  var serverTaskId: String?
  var authPolicy: String?
  var fileExtension: String?
  var downloadedFilePath: String?
  var photoAssetId: String?
  var iosCompatible: Bool?
  var iosCompatibleRetryConsumed: Bool?
}

private struct NativeSilentDownloadSnapshot: Codable {
  var tasks: [NativeSilentDownloadTask]
  var pausedReason: String?
  var pauseMessage: String?
}

private struct NativeSilentDownloadConfig: Codable {
  var apiBaseUrl: String
  var enabled: Bool
}

private struct LegacyNativeSilentDownloadConfig: Codable {
  var apiBaseUrl: String
  var authToken: String?
  var enabled: Bool
}

private struct NativePreparedDownload {
  var url: String
  var authToken: String?
  var title: String
  var platform: String?
  var quality: String?
  var iosCompatible: Bool
  var runtimeTraceId: String?
  var fileExtension: String?
  var serverTaskId: String?
  var authPolicy: String
}

private struct NativeSilentDownloadPauseError: Error {
  let reason: String
  let message: String
}

private struct NativeSilentDownloadRetryablePrepareError: Error {
  let message: String
}

private enum NativeSilentDownloadKeychain {
  static func loadAuthToken() -> String? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: nativeSilentDownloadAuthTokenService,
      kSecAttrAccount as String: nativeSilentDownloadAuthTokenAccount,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]

    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    guard status == errSecSuccess, let data = item as? Data else {
      return nil
    }

    return String(data: data, encoding: .utf8)?.nilIfEmpty
  }

  static func setAuthToken(_ authToken: String?) {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: nativeSilentDownloadAuthTokenService,
      kSecAttrAccount as String: nativeSilentDownloadAuthTokenAccount,
    ]

    SecItemDelete(query as CFDictionary)

    guard let token = authToken?.nilIfEmpty,
          let data = token.data(using: .utf8)
    else {
      return
    }

    var item = query
    item[kSecValueData as String] = data
    item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    SecItemAdd(item as CFDictionary, nil)
  }
}

final class NativeSilentDownloadService: NSObject, URLSessionDownloadDelegate, URLSessionTaskDelegate {
  static let shared = NativeSilentDownloadService()

  private let backgroundSessionIdentifier = "com.vsave.mobile.native-silent-download"
  private let queue = DispatchQueue(label: "com.vsave.mobile.native-silent-download")
  private let fileManager = FileManager.default
  private let encoder = JSONEncoder()
  private let decoder = JSONDecoder()

  private weak var emitter: NativeSilentDownloadManager?
  private var snapshot: NativeSilentDownloadSnapshot
  private var config: NativeSilentDownloadConfig
  private var authToken: String?
  private var activeTaskId: String?
  private var backgroundCompletionHandler: (() -> Void)?
  private var runtimeBackgroundTaskIdentifiers: [String: UIBackgroundTaskIdentifier] = [:]

  private lazy var backgroundSession: URLSession = {
    let configuration = URLSessionConfiguration.background(withIdentifier: backgroundSessionIdentifier)
    configuration.sessionSendsLaunchEvents = true
    configuration.isDiscretionary = false
    configuration.waitsForConnectivity = true
    if #available(iOS 13.0, *) {
      configuration.allowsExpensiveNetworkAccess = true
      configuration.allowsConstrainedNetworkAccess = true
    }
    configuration.timeoutIntervalForRequest = 30 * 60
    configuration.timeoutIntervalForResource = 6 * 60 * 60
    return URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
  }()

  private override init() {
    self.snapshot = NativeSilentDownloadService.loadSnapshot()
    self.config = NativeSilentDownloadService.loadConfig()
    self.authToken = NativeSilentDownloadKeychain.loadAuthToken()
    super.init()
    _ = backgroundSession
    queue.async { [weak self] in
      self?.resumePersistedRuntimeState(allowActiveWork: false)
    }
  }

  func attachEmitter(_ emitter: NativeSilentDownloadManager) {
    queue.async {
      self.emitter = emitter
      self.emitSnapshot()
    }
  }

  func detachEmitter(_ emitter: NativeSilentDownloadManager) {
    queue.async {
      if self.emitter === emitter {
        self.emitter = nil
      }
    }
  }

  func handleEventsForBackgroundURLSession(
    identifier: String,
    completionHandler: @escaping () -> Void
  ) {
    guard identifier == backgroundSessionIdentifier else {
      completionHandler()
      return
    }

    queue.async {
      self.backgroundCompletionHandler = completionHandler
    }
  }

  func bootstrap(_ payload: [String: Any]) throws -> [String: Any] {
    return try queue.sync {
      try applyConfig(payload)
      if snapshot.tasks.isEmpty {
        let legacySnapshot = try snapshotFromDictionary(payload["legacyState"] as? [String: Any])
        if !legacySnapshot.tasks.isEmpty || legacySnapshot.pausedReason != nil || legacySnapshot.pauseMessage != nil {
          snapshot = legacySnapshot
          persistSnapshot()
        }
      }
      resumePersistedRuntimeState(allowActiveWork: false)
      emitSnapshot()
      return snapshotDictionary()
    }
  }

  func configure(_ payload: [String: Any]) throws -> [String: Any] {
    return try queue.sync {
      try applyConfig(payload)
      refreshAuthPauseState()
      if !config.enabled {
        persistSnapshot()
        emitSnapshot()
        return snapshotDictionary()
      }

      resumePersistedRuntimeState(allowActiveWork: true)
      emitSnapshot()
      return snapshotDictionary()
    }
  }

  func enqueueTask(_ payload: [String: Any]) throws -> [String: Any] {
    return try queue.sync {
      var task = try taskFromDictionary(payload)
      if isDuplicateActiveTask(task.dedupeKey) {
        return [
          "accepted": false,
          "task": NSNull(),
        ]
      }

      task.status = .queued
      task.progress = 0
      task.updatedAt = nowMs()
      snapshot.tasks.append(task)
      persistSnapshot()
      emitSnapshot()
      startNextQueuedTaskIfPossible()
      return [
        "accepted": true,
        "task": taskDictionary(task),
      ]
    }
  }

  func removeTask(_ taskId: String) -> [String: Any] {
    queue.sync {
      snapshot.tasks.removeAll { task in
        task.id == taskId && task.id != activeTaskId
      }
      persistSnapshot()
      emitSnapshot()
      return snapshotDictionary()
    }
  }

  func clearFinished() -> [String: Any] {
    queue.sync {
      snapshot.tasks.removeAll { task in
        task.status == .completed || task.status == .failed
      }
      persistSnapshot()
      emitSnapshot()
      return snapshotDictionary()
    }
  }

  func resumeQueue() -> [String: Any] {
    queue.sync {
      snapshot.pausedReason = nil
      snapshot.pauseMessage = nil
      refreshAuthPauseState()
      persistSnapshot()
      emitSnapshot()
      resumePersistedRuntimeState(allowActiveWork: true)
      return snapshotDictionary()
    }
  }

  func getSnapshot() -> [String: Any] {
    queue.sync {
      snapshotDictionary()
    }
  }

  func urlSession(
    _ session: URLSession,
    downloadTask: URLSessionDownloadTask,
    didWriteData bytesWritten: Int64,
    totalBytesWritten: Int64,
    totalBytesExpectedToWrite: Int64
  ) {
    guard let taskId = downloadTask.taskDescription else {
      return
    }

    queue.async {
      guard let index = self.snapshot.tasks.firstIndex(where: { $0.id == taskId }) else {
        return
      }
      guard self.snapshot.tasks[index].status == .downloading else {
        return
      }

      let progress: Int
      if totalBytesExpectedToWrite > 0 {
        let ratio = Double(totalBytesWritten) / Double(totalBytesExpectedToWrite)
        progress = min(95, max(5, Int((ratio * 90.0).rounded())))
      } else if totalBytesWritten > 0 {
        let loadedMb = Double(totalBytesWritten) / (1024.0 * 1024.0)
        progress = min(95, max(5, Int((5.0 + log2(loadedMb + 1.0) * 16.0).rounded())))
      } else {
        progress = 5
      }

      if progress > self.snapshot.tasks[index].progress {
        self.snapshot.tasks[index].progress = progress
        self.snapshot.tasks[index].updatedAt = self.nowMs()
        self.persistSnapshot()
        self.emitSnapshot()
      }
    }
  }

  func urlSession(
    _ session: URLSession,
    downloadTask: URLSessionDownloadTask,
    didFinishDownloadingTo location: URL
  ) {
    guard let taskId = downloadTask.taskDescription else {
      return
    }

    // URLSession only guarantees the temporary download file during this callback.
    // Move or read it before returning, otherwise the system may purge it.
    queue.sync {
      guard let index = self.snapshot.tasks.firstIndex(where: { $0.id == taskId }) else {
        return
      }
      guard self.snapshot.tasks[index].status == .downloading else {
        return
      }

      let statusCode = (downloadTask.response as? HTTPURLResponse)?.statusCode ?? 200
      if !(200 ... 299).contains(statusCode) {
        let message = self.readResponseMessage(from: location) ?? "后台下载失败（HTTP \(statusCode)）"
        if statusCode == 401 || statusCode == 403 {
          self.handleTerminalFailure(
            taskId: taskId,
            error: NativeSilentDownloadPauseError(
              reason: "auth_required",
              message: message
            ),
            allowRefreshRetry: true
          )
        } else {
          self.handleTerminalFailure(
            taskId: taskId,
            error: NSError(domain: "NativeSilentDownload", code: statusCode, userInfo: [
              NSLocalizedDescriptionKey: message,
            ]),
            allowRefreshRetry: false
          )
        }
        try? self.fileManager.removeItem(at: location)
        return
      }

      self.snapshot.tasks[index].status = .saving
      self.snapshot.tasks[index].progress = max(self.snapshot.tasks[index].progress, 96)
      self.snapshot.tasks[index].updatedAt = self.nowMs()
      self.snapshot.tasks[index].nativeTaskIdentifier = nil
      self.persistSnapshot()
      self.emitSnapshot()

      let fileExtension = self.resolvedFileExtension(
        for: self.snapshot.tasks[index],
        response: downloadTask.response
      )

      do {
        let persistedFileUrl = try self.moveDownloadedFile(
          from: location,
          taskId: taskId,
          fileExtension: fileExtension
        )
        self.snapshot.tasks[index].downloadedFilePath = persistedFileUrl.path
        self.persistSnapshot()
        self.emitSnapshot()
        self.resumeSavingTaskIfPossible(taskId: taskId, fileURL: persistedFileUrl)
      } catch {
        self.handleTerminalFailure(taskId: taskId, error: error, allowRefreshRetry: false)
      }
    }
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    guard let error, let taskId = task.taskDescription else {
      return
    }

    queue.async {
      if self.taskFinished(taskId: taskId) {
        return
      }
      guard let index = self.snapshot.tasks.firstIndex(where: { $0.id == taskId }) else {
        return
      }
      guard self.snapshot.tasks[index].status == .downloading || self.snapshot.tasks[index].status == .saving else {
        return
      }
      self.handleTerminalFailure(taskId: taskId, error: error, allowRefreshRetry: false)
    }
  }

  func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
    queue.async {
      let completionHandler = self.backgroundCompletionHandler
      self.backgroundCompletionHandler = nil
      DispatchQueue.main.async {
        completionHandler?()
      }
    }
  }

  private func applyConfig(_ payload: [String: Any]) throws {
    let apiBaseUrl = String(payload["apiBaseUrl"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    if !apiBaseUrl.isEmpty {
      config.apiBaseUrl = apiBaseUrl
    }
    if payload.keys.contains("authToken") {
      let nextAuthToken = String(payload["authToken"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
      authToken = nextAuthToken.isEmpty ? nil : nextAuthToken
      NativeSilentDownloadKeychain.setAuthToken(authToken)
    }
    config.enabled = (payload["enabled"] as? Bool) == true
    persistConfig()
  }

  private func resumePersistedRuntimeState(allowActiveWork: Bool) {
    activeTaskId = nil
    var didChange = false
    refreshAuthPauseState()
    let canRunActiveWork = allowActiveWork && config.enabled && snapshot.pausedReason == nil

    for index in snapshot.tasks.indices {
      switch snapshot.tasks[index].status {
      case .preparing:
        requeueTaskForRecovery(at: index)
        didChange = true
      case .saving:
        guard let fileURL = existingDownloadedFileUrl(for: snapshot.tasks[index]) else {
          requeueTaskForRecovery(at: index)
          didChange = true
          continue
        }

        snapshot.tasks[index].status = .saving
        snapshot.tasks[index].progress = max(snapshot.tasks[index].progress, 96)
        snapshot.tasks[index].updatedAt = nowMs()
        snapshot.tasks[index].nativeTaskIdentifier = nil
        snapshot.tasks[index].downloadedFilePath = fileURL.path
        didChange = true
        if canRunActiveWork {
          activeTaskId = snapshot.tasks[index].id
          persistSnapshot()
          emitSnapshot()
          resumeSavingTaskIfPossible(taskId: snapshot.tasks[index].id, fileURL: fileURL)
          return
        }
      case .downloading:
        continue
      case .queued, .completed, .failed:
        continue
      }
    }

    if didChange {
      persistSnapshot()
      emitSnapshot()
    }
    if canRunActiveWork {
      reconcileBackgroundSessionTasks()
    }
  }

  private func requeueTaskForRecovery(at index: Int) {
    snapshot.tasks[index].status = .queued
    snapshot.tasks[index].progress = 0
    snapshot.tasks[index].updatedAt = nowMs()
    snapshot.tasks[index].finishedAt = nil
    snapshot.tasks[index].nativeTaskIdentifier = nil
    snapshot.tasks[index].serverTaskId = nil
    snapshot.tasks[index].downloadedFilePath = nil
    snapshot.tasks[index].photoAssetId = nil
  }

  private func reconcileBackgroundSessionTasks() {
    backgroundSession.getAllTasks { tasks in
      self.queue.async {
        self.syncBackgroundDownloadTasks(tasks.compactMap { $0 as? URLSessionDownloadTask })
      }
    }
  }

  private func syncBackgroundDownloadTasks(_ sessionTasks: [URLSessionDownloadTask]) {
    let sessionTaskById = sessionTasks.reduce(into: [String: URLSessionDownloadTask]()) { result, task in
      guard let taskId = task.taskDescription?.nilIfEmpty else {
        return
      }
      result[taskId] = task
    }

    var didChange = false
    activeTaskId = nil

    for index in snapshot.tasks.indices {
      guard snapshot.tasks[index].status == .downloading else {
        continue
      }

      let taskId = snapshot.tasks[index].id
      if let sessionTask = sessionTaskById[taskId], sessionTask.state != URLSessionTask.State.completed {
        let identifier = sessionTask.taskIdentifier
        if snapshot.tasks[index].nativeTaskIdentifier != identifier {
          snapshot.tasks[index].nativeTaskIdentifier = identifier
          snapshot.tasks[index].updatedAt = nowMs()
          didChange = true
        }
        activeTaskId = taskId
        continue
      }

      if let fileURL = existingDownloadedFileUrl(for: snapshot.tasks[index]) {
        snapshot.tasks[index].status = .saving
        snapshot.tasks[index].progress = max(snapshot.tasks[index].progress, 96)
        snapshot.tasks[index].updatedAt = nowMs()
        snapshot.tasks[index].nativeTaskIdentifier = nil
        snapshot.tasks[index].downloadedFilePath = fileURL.path
        activeTaskId = taskId
        didChange = true
        persistSnapshot()
        emitSnapshot()
        resumeSavingTaskIfPossible(taskId: taskId, fileURL: fileURL)
        return
      }

      requeueTaskForRecovery(at: index)
      didChange = true
    }

    if didChange {
      persistSnapshot()
      emitSnapshot()
    }

    if activeTaskId == nil {
      startNextQueuedTaskIfPossible()
    }
  }

  private func startNextQueuedTaskIfPossible() {
    refreshAuthPauseState()
    guard config.enabled else {
      return
    }
    guard snapshot.pausedReason == nil else {
      return
    }
    guard activeTaskId == nil else {
      return
    }
    guard let index = snapshot.tasks.firstIndex(where: { $0.status == .queued }) else {
      return
    }

    let task = snapshot.tasks[index]
    activeTaskId = task.id
    updateTask(taskId: task.id) { item in
      item.status = .preparing
      item.progress = max(item.progress, 1)
      item.startedAt = item.startedAt ?? nowMs()
      item.updatedAt = nowMs()
      item.errorMessage = nil
    }
    beginRuntimeBackgroundTask(taskId: task.id, name: "native-silent-prepare-\(task.id)")

    let taskSnapshot = snapshot.tasks[index]
    let configSnapshot = config
    Task {
      do {
        let prepared = try await prepareDownload(for: taskSnapshot, config: configSnapshot)
        queue.async {
          self.startBackgroundDownload(taskId: taskSnapshot.id, prepared: prepared)
        }
      } catch {
        queue.async {
          self.handlePrepareFailure(taskId: taskSnapshot.id, error: error)
        }
      }
    }
  }

  private func prepareDownload(
    for task: NativeSilentDownloadTask,
    config: NativeSilentDownloadConfig
  ) async throws -> NativePreparedDownload {
    let apiBaseUrl = config.apiBaseUrl.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !apiBaseUrl.isEmpty else {
      throw NativeSilentDownloadPauseError(
        reason: "auth_required",
        message: "静默下载配置缺失，请重新登录后重试"
      )
    }

    guard let token = authToken, !token.isEmpty else {
      throw NativeSilentDownloadPauseError(
        reason: "auth_required",
        message: "登录态已失效，静默下载队列已暂停，请重新登录后手动恢复队列。"
      )
    }

    guard let url = URL(string: "\(apiBaseUrl)/download/prepare-native-silent") else {
      throw NSError(domain: "NativeSilentDownload", code: -1, userInfo: [
        NSLocalizedDescriptionKey: "静默下载接口地址无效",
      ])
    }

    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    request.timeoutInterval = 30
    var requestBody: [String: Any] = [
      "sourceUrl": task.sourceUrl,
      "clientType": "MOBILE",
    ]
    if let iosCompatible = task.iosCompatible {
      requestBody["iosCompatible"] = iosCompatible
    }
    request.httpBody = try JSONSerialization.data(withJSONObject: requestBody)

    let (data, response) = try await URLSession.shared.data(for: request)
    let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 200
    let json = (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
    if !(200 ... 299).contains(statusCode) {
      let message = resolveApiErrorMessage(json) ?? "静默下载准备失败"
      if statusCode == 401 || statusCode == 403 {
        throw NativeSilentDownloadPauseError(
          reason: "auth_required",
          message: message
        )
      }
      throw NSError(domain: "NativeSilentDownload", code: statusCode, userInfo: [
        NSLocalizedDescriptionKey: message,
      ])
    }

    guard let dataPayload = json["data"] as? [String: Any] else {
      throw NSError(domain: "NativeSilentDownload", code: -2, userInfo: [
        NSLocalizedDescriptionKey: "静默下载准备结果为空",
      ])
    }

    let mode = String(dataPayload["mode"] as? String ?? "")
    let runtimeTraceId = String(dataPayload["runtimeTraceId"] as? String ?? "").nilIfEmpty
    let title = String(dataPayload["fileName"] as? String ?? "").nilIfEmpty ?? (task.title?.nilIfEmpty ?? "vsave-video")
    let platform = String(dataPayload["platform"] as? String ?? "").nilIfEmpty
    let quality = String(dataPayload["quality"] as? String ?? "").nilIfEmpty
    let authPolicy = String(dataPayload["authPolicy"] as? String ?? "none")
    let iosCompatible = (dataPayload["iosCompatible"] as? Bool) == true

    if mode == "serverTask" {
      let serverTaskId = String(dataPayload["taskId"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
      guard !serverTaskId.isEmpty else {
        throw NSError(domain: "NativeSilentDownload", code: -3, userInfo: [
          NSLocalizedDescriptionKey: "后台下载任务创建失败",
        ])
      }
      guard let taskFileUrl = URL(
        string: "\(apiBaseUrl)/download/tasks/\(serverTaskId)/file?wait=1&timeoutMs=900000"
      ) else {
        throw NSError(domain: "NativeSilentDownload", code: -4, userInfo: [
          NSLocalizedDescriptionKey: "后台下载文件地址无效",
        ])
      }
      return NativePreparedDownload(
        url: taskFileUrl.absoluteString,
        authToken: token,
        title: title,
        platform: platform,
        quality: quality,
        iosCompatible: iosCompatible,
        runtimeTraceId: runtimeTraceId,
        fileExtension: "mp4",
        serverTaskId: serverTaskId,
        authPolicy: authPolicy.isEmpty ? "bearer" : authPolicy
      )
    }

    let downloadUrl = String(dataPayload["downloadUrl"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    guard !downloadUrl.isEmpty else {
      throw NSError(domain: "NativeSilentDownload", code: -5, userInfo: [
        NSLocalizedDescriptionKey: "静默下载直链为空",
      ])
    }

    return NativePreparedDownload(
      url: downloadUrl,
      authToken: authPolicy == "bearer" ? token : nil,
      title: title,
      platform: platform,
      quality: quality,
      iosCompatible: iosCompatible,
      runtimeTraceId: runtimeTraceId,
      fileExtension: String(dataPayload["fileExtension"] as? String ?? "").nilIfEmpty,
      serverTaskId: nil,
      authPolicy: authPolicy.isEmpty ? "none" : authPolicy
    )
  }

  private func startBackgroundDownload(taskId: String, prepared: NativePreparedDownload) {
    guard let index = snapshot.tasks.firstIndex(where: { $0.id == taskId }) else {
      endRuntimeBackgroundTask(taskId: taskId)
      activeTaskId = nil
      return
    }

    guard let url = URL(string: prepared.url) else {
      handleTerminalFailure(taskId: taskId, error: NSError(domain: "NativeSilentDownload", code: -6, userInfo: [
        NSLocalizedDescriptionKey: "后台下载链接无效",
      ]), allowRefreshRetry: false)
      return
    }

    var request = URLRequest(url: url)
    request.timeoutInterval = 30 * 60
    if let token = prepared.authToken, !token.isEmpty {
      request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    }
    if let traceId = prepared.runtimeTraceId, !traceId.isEmpty {
      request.setValue(traceId, forHTTPHeaderField: "x-runtime-trace-id")
    }

    let downloadTask = backgroundSession.downloadTask(with: request)
    downloadTask.taskDescription = taskId
    downloadTask.resume()

    snapshot.tasks[index].status = .downloading
    snapshot.tasks[index].progress = max(snapshot.tasks[index].progress, 5)
    snapshot.tasks[index].updatedAt = nowMs()
    snapshot.tasks[index].startedAt = snapshot.tasks[index].startedAt ?? nowMs()
    snapshot.tasks[index].title = prepared.title
    snapshot.tasks[index].platform = prepared.platform
    snapshot.tasks[index].quality = prepared.quality
    snapshot.tasks[index].iosCompatible = prepared.iosCompatible
    snapshot.tasks[index].runtimeTraceId = prepared.runtimeTraceId
    snapshot.tasks[index].serverTaskId = prepared.serverTaskId
    snapshot.tasks[index].authPolicy = prepared.authPolicy
    snapshot.tasks[index].fileExtension = prepared.fileExtension
    snapshot.tasks[index].downloadedFilePath = nil
    snapshot.tasks[index].photoAssetId = nil
    snapshot.tasks[index].nativeTaskIdentifier = downloadTask.taskIdentifier
    persistSnapshot()
    emitSnapshot()
    endRuntimeBackgroundTask(taskId: taskId)
  }

  private func handlePrepareFailure(taskId: String, error: Error) {
    handleTerminalFailure(taskId: taskId, error: error, allowRefreshRetry: false)
  }

  private func handleTerminalFailure(taskId: String, error: Error, allowRefreshRetry: Bool) {
    guard let index = snapshot.tasks.firstIndex(where: { $0.id == taskId }) else {
      endRuntimeBackgroundTask(taskId: taskId)
      activeTaskId = nil
      startNextQueuedTaskIfPossible()
      return
    }

    let retryCount = snapshot.tasks[index].retryCount ?? 0
    if allowRefreshRetry, retryCount < 1 {
      snapshot.tasks[index].status = .queued
      snapshot.tasks[index].progress = 0
      snapshot.tasks[index].retryCount = retryCount + 1
      snapshot.tasks[index].updatedAt = nowMs()
      snapshot.tasks[index].errorMessage = nil
      snapshot.tasks[index].nativeTaskIdentifier = nil
      snapshot.tasks[index].serverTaskId = nil
      snapshot.tasks[index].downloadedFilePath = nil
      activeTaskId = nil
      endRuntimeBackgroundTask(taskId: taskId)
      persistSnapshot()
      emitSnapshot()
      startNextQueuedTaskIfPossible()
      return
    }

    if let pauseError = error as? NativeSilentDownloadPauseError {
      snapshot.pausedReason = pauseError.reason
      snapshot.pauseMessage = pauseError.message
      snapshot.tasks[index].updatedAt = nowMs()
      snapshot.tasks[index].errorMessage = pauseError.message
      snapshot.tasks[index].nativeTaskIdentifier = nil
      snapshot.tasks[index].serverTaskId = nil
      snapshot.tasks[index].finishedAt = nil

      if pauseError.reason == "photo_permission_denied",
         let fileURL = existingDownloadedFileUrl(for: snapshot.tasks[index]) {
        snapshot.tasks[index].status = .saving
        snapshot.tasks[index].progress = max(snapshot.tasks[index].progress, 96)
        snapshot.tasks[index].downloadedFilePath = fileURL.path
      } else {
        snapshot.tasks[index].status = .queued
        snapshot.tasks[index].progress = 0
        snapshot.tasks[index].downloadedFilePath = nil
      }

      activeTaskId = nil
      endRuntimeBackgroundTask(taskId: taskId)
      persistSnapshot()
      emitSnapshot()
      sendLocalNotification(
        title: "静默下载已暂停",
        body: pauseError.message
      )
      return
    }

    let taskTitle = snapshot.tasks[index].title?.nilIfEmpty ?? "视频"
    snapshot.tasks[index].status = .failed
    snapshot.tasks[index].progress = 0
    snapshot.tasks[index].updatedAt = nowMs()
    snapshot.tasks[index].finishedAt = nowMs()
    snapshot.tasks[index].errorMessage = error.localizedDescription
    snapshot.tasks[index].nativeTaskIdentifier = nil
    snapshot.tasks[index].serverTaskId = nil
    snapshot.tasks[index].downloadedFilePath = nil

    activeTaskId = nil
    endRuntimeBackgroundTask(taskId: taskId)
    persistSnapshot()
    emitSnapshot()
    sendLocalNotification(
      title: "静默下载失败",
      body: "\(taskTitle)：\(error.localizedDescription)"
    )
    startNextQueuedTaskIfPossible()
  }

  private func retryTaskWithIosCompatibleFallbackIfNeeded(taskId: String, error: Error) -> Bool {
    guard let index = snapshot.tasks.firstIndex(where: { $0.id == taskId }) else {
      return false
    }
    guard shouldRetryWithIosCompatibleFallback(task: snapshot.tasks[index], error: error) else {
      return false
    }

    snapshot.tasks[index].status = .queued
    snapshot.tasks[index].progress = 0
    snapshot.tasks[index].updatedAt = nowMs()
    snapshot.tasks[index].finishedAt = nil
    snapshot.tasks[index].errorMessage = nil
    snapshot.tasks[index].nativeTaskIdentifier = nil
    snapshot.tasks[index].serverTaskId = nil
    snapshot.tasks[index].downloadedFilePath = nil
    snapshot.tasks[index].photoAssetId = nil
    snapshot.tasks[index].fileExtension = nil
    snapshot.tasks[index].iosCompatible = true
    snapshot.tasks[index].iosCompatibleRetryConsumed = true
    activeTaskId = nil
    endRuntimeBackgroundTask(taskId: taskId)
    persistSnapshot()
    emitSnapshot()
    startNextQueuedTaskIfPossible()
    return true
  }

  private func shouldRetryWithIosCompatibleFallback(
    task: NativeSilentDownloadTask,
    error: Error
  ) -> Bool {
    return isIosPhotosIncompatibleError(error) &&
      task.iosCompatible != true &&
      task.iosCompatibleRetryConsumed != true
  }

  private func isIosPhotosIncompatibleError(_ error: Error) -> Bool {
    let nsError = error as NSError
    if nsError.domain == PHPhotosErrorDomain, nsError.code == 3301 {
      return true
    }

    let normalizedMessage = error.localizedDescription.lowercased()
    return normalizedMessage.contains("phphotoserrordomain error 3301") ||
      normalizedMessage.contains("ios 相册不兼容") ||
      normalizedMessage.contains("当前视频编码不兼容 ios 相册")
  }

  private func markTaskCompleted(taskId: String, photoAssetId: String?) {
    guard let index = snapshot.tasks.firstIndex(where: { $0.id == taskId }) else {
      endRuntimeBackgroundTask(taskId: taskId)
      activeTaskId = nil
      startNextQueuedTaskIfPossible()
      return
    }

    snapshot.tasks[index].status = .completed
    snapshot.tasks[index].progress = 100
    snapshot.tasks[index].updatedAt = nowMs()
    snapshot.tasks[index].finishedAt = nowMs()
    snapshot.tasks[index].errorMessage = nil
    snapshot.tasks[index].nativeTaskIdentifier = nil
    snapshot.tasks[index].serverTaskId = nil
    snapshot.tasks[index].downloadedFilePath = nil
    snapshot.tasks[index].photoAssetId = photoAssetId
    activeTaskId = nil
    endRuntimeBackgroundTask(taskId: taskId)
    persistSnapshot()
    emitSnapshot()
    startNextQueuedTaskIfPossible()
  }

  private func updateTask(taskId: String, update: (inout NativeSilentDownloadTask) -> Void) {
    guard let index = snapshot.tasks.firstIndex(where: { $0.id == taskId }) else {
      return
    }
    update(&snapshot.tasks[index])
    persistSnapshot()
    emitSnapshot()
  }

  private func isDuplicateActiveTask(_ dedupeKey: String) -> Bool {
    let normalizedKey = dedupeKey.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    guard !normalizedKey.isEmpty else {
      return false
    }

    return snapshot.tasks.contains { task in
      let active = task.status == .queued || task.status == .preparing || task.status == .downloading || task.status == .saving
      return active && task.dedupeKey.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == normalizedKey
    }
  }

  private func taskFinished(taskId: String) -> Bool {
    guard let task = snapshot.tasks.first(where: { $0.id == taskId }) else {
      return true
    }
    return task.status == .completed || task.status == .failed
  }

  private func resumeSavingTaskIfPossible(taskId: String, fileURL: URL) {
    beginRuntimeBackgroundTask(taskId: taskId, name: "native-silent-save-\(taskId)")
    Task {
      do {
        let photoAssetId = try await self.saveToPhotoLibrary(fileURL: fileURL)
        self.queue.async {
          try? self.fileManager.removeItem(at: fileURL)
          self.markTaskCompleted(taskId: taskId, photoAssetId: photoAssetId)
        }
      } catch {
        self.queue.async {
          if self.retryTaskWithIosCompatibleFallbackIfNeeded(taskId: taskId, error: error) {
            try? self.fileManager.removeItem(at: fileURL)
            return
          }
          if !(error is NativeSilentDownloadPauseError) {
            try? self.fileManager.removeItem(at: fileURL)
          }
          self.handleTerminalFailure(taskId: taskId, error: error, allowRefreshRetry: false)
        }
      }
    }
  }

  private func moveDownloadedFile(from location: URL, taskId: String, fileExtension: String) throws -> URL {
    let destination = try cachedDownloadedFileUrl(taskId: taskId, fileExtension: fileExtension)
    try? fileManager.removeItem(at: destination)
    try fileManager.moveItem(at: location, to: destination)
    return destination
  }

  private func cachedDownloadedFileUrl(taskId: String, fileExtension: String?) throws -> URL {
    let directory = try nativeDownloadsDirectory()
    let ext = fileExtension?.nilIfEmpty ?? "mp4"
    return directory.appendingPathComponent("\(taskId).\(ext)")
  }

  private func existingDownloadedFileUrl(for task: NativeSilentDownloadTask) -> URL? {
    if let persistedPath = task.downloadedFilePath?.nilIfEmpty {
      let persistedUrl = URL(fileURLWithPath: persistedPath)
      if fileManager.fileExists(atPath: persistedUrl.path) {
        return persistedUrl
      }
    }

    guard let cachedUrl = try? cachedDownloadedFileUrl(
      taskId: task.id,
      fileExtension: resolvedFileExtension(for: task, response: nil)
    ) else {
      return nil
    }

    return fileManager.fileExists(atPath: cachedUrl.path) ? cachedUrl : nil
  }

  private func nativeDownloadsDirectory() throws -> URL {
    let root = fileManager.urls(for: .cachesDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("NativeSilentDownloads", isDirectory: true)
    if !fileManager.fileExists(atPath: root.path) {
      try fileManager.createDirectory(at: root, withIntermediateDirectories: true)
    }
    return root
  }

  private func resolvedFileExtension(for task: NativeSilentDownloadTask, response: URLResponse?) -> String {
    if let ext = task.fileExtension?.nilIfEmpty {
      return ext.replacingOccurrences(of: ".", with: "")
    }

    if let url = response?.url, let ext = url.pathExtension.nilIfEmpty {
      return ext
    }

    return "mp4"
  }

  private func readResponseMessage(from location: URL) -> String? {
    guard let data = try? Data(contentsOf: location),
          let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else {
      return nil
    }
    return resolveApiErrorMessage(json)
  }

  private func resolveApiErrorMessage(_ json: [String: Any]) -> String? {
    if let message = json["message"] as? String, !message.isEmpty {
      return message
    }
    if let nested = json["message"] as? [String: Any],
       let message = nested["message"] as? String,
       !message.isEmpty {
      return message
    }
    if let messages = json["message"] as? [String], let first = messages.first, !first.isEmpty {
      return first
    }
    return nil
  }

  private func saveToPhotoLibrary(fileURL: URL) async throws -> String? {
    let status = PHPhotoLibrary.authorizationStatus(for: .addOnly)
    let granted = status == .authorized || status == .limited
    if !granted {
      throw NativeSilentDownloadPauseError(
        reason: "photo_permission_denied",
        message: "未获得相册写入权限，请允许 V-SAVE 保存到照片后恢复静默下载队列。"
      )
    }

    return try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<String?, Error>) in
      var localIdentifier: String?
      PHPhotoLibrary.shared().performChanges({
        let changeRequest = PHAssetChangeRequest.creationRequestForAssetFromVideo(atFileURL: fileURL)
        localIdentifier = changeRequest?.placeholderForCreatedAsset?.localIdentifier
      }, completionHandler: { success, error in
        if let error {
          continuation.resume(throwing: error)
          return
        }

        if success {
          continuation.resume(returning: localIdentifier)
        } else {
          continuation.resume(throwing: NSError(domain: "NativeSilentDownload", code: -7, userInfo: [
            NSLocalizedDescriptionKey: "保存到系统相册失败",
          ]))
        }
      })
    }
  }

  private func beginRuntimeBackgroundTask(taskId: String, name: String) {
    endRuntimeBackgroundTask(taskId: taskId)
    let expirationHandler: () -> Void = { [weak self] in
      self?.queue.async { [weak self] in
        guard let self else {
          return
        }
        self.endRuntimeBackgroundTask(taskId: taskId)
      }
    }

    let identifier: UIBackgroundTaskIdentifier
    if Thread.isMainThread {
      identifier = UIApplication.shared.beginBackgroundTask(withName: name, expirationHandler: expirationHandler)
    } else {
      identifier = DispatchQueue.main.sync {
        UIApplication.shared.beginBackgroundTask(withName: name, expirationHandler: expirationHandler)
      }
    }
    runtimeBackgroundTaskIdentifiers[taskId] = identifier
  }

  private func endRuntimeBackgroundTask(taskId: String) {
    guard let identifier = runtimeBackgroundTaskIdentifiers.removeValue(forKey: taskId),
          identifier != .invalid
    else {
      return
    }

    let end = {
      UIApplication.shared.endBackgroundTask(identifier)
    }
    if Thread.isMainThread {
      end()
    } else {
      DispatchQueue.main.async(execute: end)
    }
  }

  private func sendLocalNotification(title: String, body: String) {
    let dispatch = {
      guard UIApplication.shared.applicationState != .active else {
        return
      }

      let content = UNMutableNotificationContent()
      content.title = title
      content.body = body
      content.sound = nil

      let request = UNNotificationRequest(
        identifier: "native-silent-download-\(UUID().uuidString)",
        content: content,
        trigger: nil
      )
      UNUserNotificationCenter.current().add(request)
    }

    if Thread.isMainThread {
      dispatch()
    } else {
      DispatchQueue.main.async(execute: dispatch)
    }
  }

  private func snapshotDictionary() -> [String: Any] {
    [
      "tasks": snapshot.tasks.map(taskDictionary),
      "pausedReason": snapshot.pausedReason as Any,
      "pauseMessage": snapshot.pauseMessage as Any,
    ]
  }

  private func taskDictionary(_ task: NativeSilentDownloadTask) -> [String: Any] {
    var payload: [String: Any] = [
      "id": task.id,
      "sourceUrl": task.sourceUrl,
      "dedupeKey": task.dedupeKey,
      "status": task.status.rawValue,
      "progress": task.progress,
      "createdAt": task.createdAt,
      "updatedAt": task.updatedAt,
    ]

    if let startedAt = task.startedAt {
      payload["startedAt"] = startedAt
    }
    if let finishedAt = task.finishedAt {
      payload["finishedAt"] = finishedAt
    }
    if let title = task.title {
      payload["title"] = title
    }
    if let platform = task.platform {
      payload["platform"] = platform
    }
    if let quality = task.quality {
      payload["quality"] = quality
    }
    if let runtimeTraceId = task.runtimeTraceId {
      payload["runtimeTraceId"] = runtimeTraceId
    }
    if let errorMessage = task.errorMessage {
      payload["errorMessage"] = errorMessage
    }
    if let retryCount = task.retryCount {
      payload["retryCount"] = retryCount
    }
    if let photoAssetId = task.photoAssetId {
      payload["photoAssetId"] = photoAssetId
    }

    return payload
  }

  private func taskFromDictionary(_ payload: [String: Any]) throws -> NativeSilentDownloadTask {
    let data = try JSONSerialization.data(withJSONObject: payload, options: [])
    let task = try decoder.decode(NativeSilentDownloadTask.self, from: data)
    return task
  }

  private func snapshotFromDictionary(_ payload: [String: Any]?) throws -> NativeSilentDownloadSnapshot {
    guard let payload else {
      return NativeSilentDownloadSnapshot(tasks: [], pausedReason: nil, pauseMessage: nil)
    }
    let data = try JSONSerialization.data(withJSONObject: payload, options: [])
    return try decoder.decode(NativeSilentDownloadSnapshot.self, from: data)
  }

  private func persistSnapshot() {
    snapshot.tasks = trimPersistedTasks(snapshot.tasks)
    refreshAuthPauseState()
    if let data = try? encoder.encode(snapshot) {
      UserDefaults.standard.set(data, forKey: nativeSilentDownloadSnapshotStorageKey)
    }
  }

  private func persistConfig() {
    if let data = try? encoder.encode(config) {
      UserDefaults.standard.set(data, forKey: nativeSilentDownloadConfigStorageKey)
    }
  }

  private func emitSnapshot() {
    let payload = snapshotDictionary()
    DispatchQueue.main.async {
      self.emitter?.sendSnapshot(payload)
    }
  }

  private func nowMs() -> Double {
    Date().timeIntervalSince1970 * 1000.0
  }

  private func refreshAuthPauseState() {
    let hasPendingTasks = snapshot.tasks.contains { task in
      task.status == .queued ||
        task.status == .preparing ||
        task.status == .downloading ||
        task.status == .saving
    }
    let hasAuthToken = authToken?.nilIfEmpty != nil

    if snapshot.pausedReason == "auth_required" {
      if hasAuthToken || !config.enabled || !hasPendingTasks {
        snapshot.pausedReason = nil
        snapshot.pauseMessage = nil
      }
    }

    if config.enabled && hasPendingTasks && !hasAuthToken {
      snapshot.pausedReason = "auth_required"
      snapshot.pauseMessage = "登录态已失效，静默下载队列已暂停，请重新登录后手动恢复队列。"
    }
  }

  private func trimPersistedTasks(_ tasks: [NativeSilentDownloadTask]) -> [NativeSilentDownloadTask] {
    let finishedTasks = tasks.filter { task in
      task.status == .completed || task.status == .failed
    }
    if finishedTasks.count <= nativeSilentDownloadFinishedLimit {
      return tasks
    }

    let retainedFinishedIds = Set(
      finishedTasks
        .sorted { left, right in
          finishedOrderValue(for: left) > finishedOrderValue(for: right)
        }
        .prefix(nativeSilentDownloadFinishedLimit)
        .map(\.id)
    )

    return tasks.filter { task in
      switch task.status {
      case .queued, .preparing, .downloading, .saving:
        return true
      case .completed, .failed:
        return retainedFinishedIds.contains(task.id)
      }
    }
  }

  private func finishedOrderValue(for task: NativeSilentDownloadTask) -> Double {
    task.finishedAt ?? task.updatedAt
  }

  private static func loadSnapshot() -> NativeSilentDownloadSnapshot {
    guard let data = UserDefaults.standard.data(forKey: nativeSilentDownloadSnapshotStorageKey),
          let snapshot = try? JSONDecoder().decode(NativeSilentDownloadSnapshot.self, from: data)
    else {
      return NativeSilentDownloadSnapshot(tasks: [], pausedReason: nil, pauseMessage: nil)
    }

    return snapshot
  }

  private static func loadConfig() -> NativeSilentDownloadConfig {
    guard let data = UserDefaults.standard.data(forKey: nativeSilentDownloadConfigStorageKey) else {
      return NativeSilentDownloadConfig(apiBaseUrl: "", enabled: false)
    }

    if let config = try? JSONDecoder().decode(NativeSilentDownloadConfig.self, from: data) {
      return config
    }

    if let legacyConfig = try? JSONDecoder().decode(LegacyNativeSilentDownloadConfig.self, from: data) {
      NativeSilentDownloadKeychain.setAuthToken(legacyConfig.authToken)
      let config = NativeSilentDownloadConfig(
        apiBaseUrl: legacyConfig.apiBaseUrl,
        enabled: legacyConfig.enabled
      )
      if let encoded = try? JSONEncoder().encode(config) {
        UserDefaults.standard.set(encoded, forKey: nativeSilentDownloadConfigStorageKey)
      }
      return config
    }

    UserDefaults.standard.removeObject(forKey: nativeSilentDownloadConfigStorageKey)
    return NativeSilentDownloadConfig(apiBaseUrl: "", enabled: false)
  }
}

@objc(NativeSilentDownloadManager)
final class NativeSilentDownloadManager: RCTEventEmitter {
  private let service = NativeSilentDownloadService.shared

  override init() {
    super.init()
  }

  @objc
  override static func requiresMainQueueSetup() -> Bool {
    false
  }

  @objc
  override func supportedEvents() -> [String]! {
    ["NativeSilentDownloadSnapshotChanged"]
  }

  override func startObserving() {
    service.attachEmitter(self)
  }

  override func stopObserving() {
    service.detachEmitter(self)
  }

  @objc(bootstrap:resolver:rejecter:)
  func bootstrap(
    _ payload: [String: Any],
    resolver resolve: RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    do {
      resolve(try service.bootstrap(payload))
    } catch {
      reject("native_silent_download_bootstrap_failed", error.localizedDescription, error)
    }
  }

  @objc(configure:resolver:rejecter:)
  func configure(
    _ payload: [String: Any],
    resolver resolve: RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    do {
      resolve(try service.configure(payload))
    } catch {
      reject("native_silent_download_configure_failed", error.localizedDescription, error)
    }
  }

  @objc(enqueueTask:resolver:rejecter:)
  func enqueueTask(
    _ payload: [String: Any],
    resolver resolve: RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    do {
      resolve(try service.enqueueTask(payload))
    } catch {
      reject("native_silent_download_enqueue_failed", error.localizedDescription, error)
    }
  }

  @objc(removeTask:resolver:rejecter:)
  func removeTask(
    _ taskId: String,
    resolver resolve: RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    resolve(service.removeTask(taskId))
  }

  @objc(clearFinished:rejecter:)
  func clearFinished(
    _ resolve: RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    resolve(service.clearFinished())
  }

  @objc(resumeQueue:rejecter:)
  func resumeQueue(
    _ resolve: RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    resolve(service.resumeQueue())
  }

  @objc(getSnapshot:rejecter:)
  func getSnapshot(
    _ resolve: RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    resolve(service.getSnapshot())
  }

  func sendSnapshot(_ payload: [String: Any]) {
    sendEvent(withName: "NativeSilentDownloadSnapshotChanged", body: payload)
  }
}

private extension String {
  var nilIfEmpty: String? {
    let normalized = trimmingCharacters(in: .whitespacesAndNewlines)
    return normalized.isEmpty ? nil : normalized
  }
}
