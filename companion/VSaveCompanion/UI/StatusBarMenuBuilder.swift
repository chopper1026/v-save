//
// Adapted from Quotio's StatusBarMenuBuilder.swift under the MIT license.
//

import AppKit
import SwiftUI

@MainActor
final class StatusBarMenuBuilder {
    private let snapshot: StatusPanelSnapshot
    private weak var target: AnyObject?
    private let actionSelector: Selector
    private let menuWidth: CGFloat = 328

    init(
        snapshot: StatusPanelSnapshot,
        target: AnyObject?,
        actionSelector: Selector
    ) {
        self.snapshot = snapshot
        self.target = target
        self.actionSelector = actionSelector
    }

    func buildMenu() -> NSMenu {
        let menu = NSMenu()
        menu.autoenablesItems = false

        menu.addItem(viewItem(for: MenuHeaderView(snapshot: snapshot)))
        menu.addItem(viewItem(for: RuntimeStatusSectionView(snapshot: snapshot)))
        menu.addItem(viewItem(for: SessionStatusSectionView(snapshot: snapshot)))
        menu.addItem(viewItem(for: ErrorSectionView(snapshot: snapshot)))
        menu.addItem(viewItem(for: SystemSettingsSectionView(snapshot: snapshot)))
        menu.addItem(actionItem(
            title: "设置管理端页面地址...",
            statusAction: .configureAdminPageOrigin
        ))
        menu.addItem(actionItem(
            title: snapshot.openAtLoginEnabled ? "关闭开机自启" : "开启开机自启",
            statusAction: .toggleOpenAtLogin
        ))
        menu.addItem(actionItem(title: "重启助手", statusAction: .restartHelper))
        menu.addItem(actionItem(title: "退出助手", statusAction: .quitApp, destructive: true))

        return menu
    }

    private func viewItem<V: View>(for view: V) -> NSMenuItem {
        let rootView = view
            .frame(width: menuWidth)
            .fixedSize(horizontal: false, vertical: true)
        let hostingView = NSHostingView(rootView: rootView)
        hostingView.setFrameSize(hostingView.fittingSize)

        let item = NSMenuItem()
        item.view = hostingView
        return item
    }

    private func actionItem(
        title: String,
        statusAction: StatusBarAction,
        destructive: Bool = false
    ) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: actionSelector, keyEquivalent: "")
        item.target = target
        item.identifier = NSUserInterfaceItemIdentifier(statusAction.menuItemIdentifier)
        if destructive {
            item.attributedTitle = NSAttributedString(
                string: title,
                attributes: [.foregroundColor: NSColor.systemRed]
            )
        }
        return item
    }
}

private enum MenuPanelStyle {
    static let menuWidth: CGFloat = 328
    static let sidePadding: CGFloat = 14
    static let headerTopPadding: CGFloat = 14
    static let headerBottomPadding: CGFloat = 12
    static let sectionVerticalPadding: CGFloat = 10
    static let dividerColor = Color.white.opacity(0.18)
    static let accentTint = Color(red: 0.88, green: 0.83, blue: 0.76)
    static let subtleFill = Color.white.opacity(0.10)
    static let subtleBorder = Color.white.opacity(0.22)
    static let buttonFill = Color.white.opacity(0.12)
    static let buttonHoverFill = Color.white.opacity(0.18)
}

private struct MenuHeaderView: View {
    let snapshot: StatusPanelSnapshot

    var body: some View {
        AnimatedSectionContainer(delay: 0.00) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("V-SAVE COMPANION")
                        .font(.system(size: 10, weight: .semibold, design: .rounded))
                        .tracking(1.8)
                        .foregroundStyle(.secondary)

                    Text("V-SAVE Companion")
                        .font(.system(size: 24, weight: .bold))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.9)

                    Text("本机抖音登录桥与辅助面板")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.9)
                }

                Spacer(minLength: 0)

                VStack(alignment: .trailing, spacing: 8) {
                    ToneBadge(text: snapshot.helperStatus, tone: snapshot.helperTone)
                    InfoCapsule(text: "v\(snapshot.appVersion)")
                }
            }
            .padding(.horizontal, MenuPanelStyle.sidePadding)
            .padding(.top, MenuPanelStyle.headerTopPadding)
            .padding(.bottom, MenuPanelStyle.headerBottomPadding)
        }
    }
}

private struct RuntimeStatusSectionView: View {
    let snapshot: StatusPanelSnapshot

    var body: some View {
        AnimatedSectionContainer(delay: 0.03) {
            SectionShell(title: "状态概览") {
                HStack(spacing: 8) {
                    StatusMetricPill(label: "助手", value: snapshot.helperStatus, tone: snapshot.helperTone)
                    StatusMetricPill(label: "Chrome", value: snapshot.chromeStatus, tone: .neutral)
                }

                CompactStatusRow(label: "本地地址", value: snapshot.serverAddress, monospaced: true)
                CompactStatusRow(
                    label: "管理端",
                    value: snapshot.adminPageOrigin ?? "未设置",
                    monospaced: snapshot.adminPageOrigin != nil
                )
                CompactStatusRow(label: "最近重启", value: snapshot.lastRestartAt)
            }
        }
    }
}

private struct SessionStatusSectionView: View {
    let snapshot: StatusPanelSnapshot

    var body: some View {
        AnimatedSectionContainer(delay: 0.06) {
            SectionShell(title: "运行状态") {
                CompactStatusRow(
                    label: "当前会话",
                    value: snapshot.currentSessionId,
                    monospaced: snapshot.currentSessionId != "无活动会话"
                )
                CompactStatusRow(label: "会话状态", value: snapshot.currentSessionStatus, boldValue: true)
                CompactStatusRow(label: "过期时间", value: snapshot.currentSessionExpiresAt)
            }
        }
    }
}

private struct ErrorSectionView: View {
    let snapshot: StatusPanelSnapshot

    var body: some View {
        AnimatedSectionContainer(delay: 0.09) {
            SectionShell(title: "最近错误") {
                ErrorNoticeRow(
                    text: snapshot.lastError ?? "暂无错误",
                    isError: snapshot.lastError != nil && !(snapshot.lastError?.isEmpty ?? true)
                )
            }
        }
    }
}

private struct SystemSettingsSectionView: View {
    let snapshot: StatusPanelSnapshot

    var body: some View {
        AnimatedSectionContainer(delay: 0.12) {
            SectionShell(title: "系统设置") {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(alignment: .center, spacing: 12) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text("开机自启")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(.primary)

                            Text(settingDetailText)
                                .font(.system(size: 11, weight: .medium))
                                .foregroundStyle(settingDetailColor)
                                .lineLimit(2)
                        }

                        Spacer(minLength: 0)

                        ToneBadge(
                            text: snapshot.openAtLoginEnabled ? "已开启" : "已关闭",
                            tone: snapshot.openAtLoginEnabled ? .success : .neutral
                        )
                    }

                    if let error = snapshot.openAtLoginError, !error.isEmpty {
                        HStack(alignment: .top, spacing: 8) {
                            Image(systemName: "info.circle.fill")
                                .font(.system(size: 11))
                                .foregroundStyle(Color(red: 0.76, green: 0.45, blue: 0.12))
                                .padding(.top, 1)

                            Text(error)
                                .font(.system(size: 11, weight: .medium))
                                .foregroundStyle(.secondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            }
        }
    }

    private var settingDetailText: String {
        if snapshot.openAtLoginError != nil {
            return "设置失败，当前为\(snapshot.openAtLoginEnabled ? "已开启" : "已关闭")"
        }

        return snapshot.openAtLoginEnabled ? "登录宿主机后自动运行" : "需要手动启动辅助程序"
    }

    private var settingDetailColor: Color {
        if snapshot.openAtLoginError != nil {
            return Color(red: 0.76, green: 0.45, blue: 0.12)
        }

        return snapshot.openAtLoginEnabled ? Color(red: 0.16, green: 0.48, blue: 0.21) : .secondary
    }
}

private struct AnimatedSectionContainer<Content: View>: View {
    let delay: Double
    var showDivider = true
    @ViewBuilder let content: Content

    @State private var isVisible = false

    var body: some View {
        VStack(spacing: 0) {
            content

            if showDivider {
                Divider()
                    .overlay(MenuPanelStyle.dividerColor)
                    .padding(.horizontal, MenuPanelStyle.sidePadding)
            }
        }
        .opacity(isVisible ? 1 : 0.0)
        .scaleEffect(isVisible ? 1 : 0.985, anchor: .top)
        .offset(y: isVisible ? 0 : -4)
        .animation(.spring(response: 0.24, dampingFraction: 0.88).delay(delay), value: isVisible)
        .onAppear {
            isVisible = true
        }
    }
}

private struct SectionShell<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            Text(title)
                .font(.system(size: 11, weight: .bold, design: .rounded))
                .tracking(0.8)
                .foregroundStyle(.secondary)

            content
        }
        .padding(.horizontal, MenuPanelStyle.sidePadding)
        .padding(.vertical, MenuPanelStyle.sectionVerticalPadding)
    }
}

private struct CompactStatusRow: View {
    let label: String
    let value: String
    var boldValue = false
    var monospaced = false

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(label)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(.secondary)
                .frame(width: 62, alignment: .leading)

            AnimatedValueText(
                value: value,
                font: valueFont,
                monospaced: monospaced
            )
            .frame(maxWidth: .infinity, alignment: .leading)

            Spacer(minLength: 0)
        }
    }

    private var valueFont: Font {
        if monospaced {
            return .system(size: 12.5, weight: boldValue ? .bold : .medium, design: .monospaced)
        }

        return .system(size: 12.5, weight: boldValue ? .bold : .medium)
    }
}

private struct AnimatedValueText: View {
    let value: String
    let font: Font
    let monospaced: Bool

    var body: some View {
        Text(value)
            .font(font)
            .foregroundStyle(.primary)
            .lineLimit(1)
            .minimumScaleFactor(monospaced ? 0.82 : 0.9)
            .truncationMode(monospaced ? .middle : .tail)
            .contentTransition(.opacity)
            .animation(.easeOut(duration: 0.18), value: value)
    }
}

private struct StatusMetricPill: View {
    let label: String
    let value: String
    let tone: StatusTone

    var body: some View {
        HStack(spacing: 7) {
            Circle()
                .fill(dotColor)
                .frame(width: 6, height: 6)

            Text(label)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.secondary)

            Text(value)
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(.primary)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(MenuPanelStyle.subtleFill)
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .strokeBorder(MenuPanelStyle.subtleBorder, lineWidth: 1)
                )
        )
    }

    private var dotColor: Color {
        switch tone {
        case .success:
            return Color(red: 0.18, green: 0.65, blue: 0.28)
        case .warning:
            return Color(red: 0.82, green: 0.56, blue: 0.16)
        case .danger:
            return Color(red: 0.80, green: 0.25, blue: 0.18)
        case .neutral:
            return MenuPanelStyle.accentTint
        }
    }
}

private struct ErrorNoticeRow: View {
    let text: String
    let isError: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: isError ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(isError ? Color(red: 0.80, green: 0.25, blue: 0.18) : Color(red: 0.18, green: 0.65, blue: 0.28))
                .padding(.top, 1)

            Text(text)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(isError ? .primary : .secondary)
                .lineLimit(2)

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(isError ? Color(red: 0.86, green: 0.42, blue: 0.32).opacity(0.09) : MenuPanelStyle.subtleFill)
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .strokeBorder(isError ? Color(red: 0.86, green: 0.42, blue: 0.32).opacity(0.14) : MenuPanelStyle.subtleBorder, lineWidth: 1)
                )
        )
    }
}

private struct ToneBadge: View {
    let text: String
    let tone: StatusTone

    var body: some View {
        Text(text)
            .font(.system(size: 13, weight: .bold, design: .rounded))
            .foregroundStyle(foregroundColor)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(
                Capsule(style: .continuous)
                    .fill(backgroundColor)
                    .overlay(
                        Capsule(style: .continuous)
                            .strokeBorder(Color.white.opacity(0.26), lineWidth: 1)
                    )
            )
    }

    private var foregroundColor: Color {
        switch tone {
        case .success:
            return Color(red: 0.10, green: 0.42, blue: 0.16)
        case .warning:
            return Color(red: 0.63, green: 0.38, blue: 0.08)
        case .danger:
            return Color(red: 0.72, green: 0.18, blue: 0.16)
        case .neutral:
            return .secondary
        }
    }

    private var backgroundColor: Color {
        switch tone {
        case .success:
            return Color.green.opacity(0.16)
        case .warning:
            return Color.orange.opacity(0.16)
        case .danger:
            return Color.red.opacity(0.14)
        case .neutral:
            return MenuPanelStyle.subtleFill
        }
    }
}

private struct InfoCapsule: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.system(size: 11, weight: .semibold, design: .rounded))
            .foregroundStyle(.secondary)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(
                Capsule(style: .continuous)
                    .fill(MenuPanelStyle.subtleFill)
                    .overlay(
                        Capsule(style: .continuous)
                            .strokeBorder(MenuPanelStyle.subtleBorder, lineWidth: 1)
                    )
            )
    }
}
