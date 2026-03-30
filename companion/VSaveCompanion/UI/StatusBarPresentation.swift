import Foundation

func buildStatusPanelSnapshot(from snapshot: CompanionRuntimeSnapshot) -> StatusPanelSnapshot {
    StatusPanelSnapshot(
        appVersion: snapshot.appVersion,
        helperStatus: helperStatusText(from: snapshot),
        helperTone: helperTone(from: snapshot),
        serverAddress: snapshot.serverAddress ?? CompanionConfig.bridgeServerAddress,
        chromeStatus: chromeStatusText(snapshot.chromeStatus),
        currentSessionId: snapshot.currentSession?.authSessionId ?? "无活动会话",
        currentSessionStatus: snapshot.currentSession.map { sessionStatusText($0.status) } ?? "--",
        currentSessionExpiresAt: snapshot.currentSession.map { shortTimestamp($0.expiresAt) } ?? "--",
        lastError: snapshot.lastError,
        openAtLoginEnabled: snapshot.openAtLoginEnabled,
        openAtLoginError: snapshot.openAtLoginError,
        lastRestartAt: shortTimestamp(snapshot.lastRestartAt)
    )
}

private func helperStatusText(from snapshot: CompanionRuntimeSnapshot) -> String {
    if snapshot.lastError != nil {
        return "异常"
    }

    switch snapshot.serverStatus {
    case "running":
        return "运行中"
    case "starting":
        return "启动中"
    case "error":
        return "异常"
    default:
        return "已停止"
    }
}

private func helperTone(from snapshot: CompanionRuntimeSnapshot) -> StatusTone {
    if snapshot.lastError != nil || snapshot.serverStatus == "error" {
        return .danger
    }

    switch snapshot.serverStatus {
    case "running":
        return .success
    case "starting":
        return .warning
    default:
        return .neutral
    }
}

private func chromeStatusText(_ status: String) -> String {
    switch status {
    case "ready":
        return "已检测到"
    case "starting":
        return "启动中"
    case "connected":
        return "已连接"
    default:
        return "空闲"
    }
}

private func sessionStatusText(_ status: LocalBridgeSessionStatus) -> String {
    switch status {
    case .waitingHelper:
        return "等待本机助手"
    case .browserOpened:
        return "已打开 Chrome"
    case .waitingScan:
        return "等待扫码"
    case .scanned:
        return "已扫码，等待确认"
    case .uploading:
        return "正在回传登录态"
    case .confirmed:
        return "已完成"
    case .failed:
        return "失败"
    case .expired:
        return "已过期"
    }
}

private func shortTimestamp(_ rawValue: String) -> String {
    guard let date = ISO8601Timestamp.parse(rawValue) else {
        return rawValue
    }

    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "zh_CN")
    formatter.timeZone = .current
    formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
    return formatter.string(from: date)
}
