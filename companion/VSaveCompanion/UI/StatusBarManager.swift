//
// Adapted from Quotio's StatusBarManager.swift under the MIT license.
//

import AppKit
import SwiftUI

@MainActor
final class StatusBarManager: NSObject, NSMenuDelegate {
    private var statusItem: NSStatusItem?
    private var menu: NSMenu?
    private var snapshotProvider: (() -> CompanionRuntimeSnapshot)?
    private var actionHandler: ((StatusBarAction) -> Void)?

    func configure(
        snapshotProvider: @escaping () -> CompanionRuntimeSnapshot,
        actionHandler: @escaping (StatusBarAction) -> Void
    ) {
        self.snapshotProvider = snapshotProvider
        self.actionHandler = actionHandler

        if statusItem == nil {
            statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        }

        guard let button = statusItem?.button else { return }
        button.target = self
        button.action = #selector(handleStatusItemClick)
        button.sendAction(on: [.leftMouseUp, .rightMouseUp])
        updateButton(with: snapshotProvider())
    }

    func update(snapshot: CompanionRuntimeSnapshot) {
        updateButton(with: snapshot)
        rebuildMenuIfVisible()
    }

    func destroy() {
        if let statusItem {
            NSStatusBar.system.removeStatusItem(statusItem)
        }
        statusItem = nil
        menu = nil
    }

    @objc private func handleStatusItemClick() {
        guard let snapshotProvider, let statusItem else { return }
        let snapshot = buildStatusPanelSnapshot(from: snapshotProvider())
        let builder = StatusBarMenuBuilder(
            snapshot: snapshot,
            target: self,
            actionSelector: #selector(handleMenuItemAction(_:))
        )
        let menu = builder.buildMenu()
        menu.delegate = self
        self.menu = menu
        statusItem.menu = menu
        statusItem.button?.performClick(nil)
    }

    @objc private func handleMenuItemAction(_ sender: NSMenuItem) {
        guard let actionHandler,
              let identifier = sender.identifier?.rawValue,
              let action = statusBarAction(for: identifier) else {
            return
        }

        actionHandler(action)
    }

    func menuDidClose(_ menu: NSMenu) {
        statusItem?.menu = nil
        self.menu = nil
    }

    private func rebuildMenuIfVisible() {
        guard let menu, statusItem?.button?.isHighlighted == true, let snapshotProvider else {
            return
        }

        let snapshot = buildStatusPanelSnapshot(from: snapshotProvider())
        let rebuiltMenu = StatusBarMenuBuilder(
            snapshot: snapshot,
            target: self,
            actionSelector: #selector(handleMenuItemAction(_:))
        ).buildMenu()
        menu.removeAllItems()
        rebuiltMenu.items.forEach(menu.addItem(_:))
    }

    private func statusBarAction(for identifier: String) -> StatusBarAction? {
        switch identifier {
        case StatusBarAction.configureAdminPageOrigin.menuItemIdentifier:
            return .configureAdminPageOrigin
        case StatusBarAction.toggleOpenAtLogin.menuItemIdentifier:
            return .toggleOpenAtLogin
        case StatusBarAction.restartHelper.menuItemIdentifier:
            return .restartHelper
        case StatusBarAction.quitApp.menuItemIdentifier:
            return .quitApp
        default:
            return nil
        }
    }

    private func updateButton(with snapshot: CompanionRuntimeSnapshot) {
        guard let button = statusItem?.button else { return }

        button.title = ""
        button.image = nil
        button.subviews.forEach { $0.removeFromSuperview() }

        let hostingView = NSHostingView(rootView: StatusBarGlyphView(snapshot: buildStatusPanelSnapshot(from: snapshot)))
        hostingView.setFrameSize(hostingView.intrinsicContentSize)

        let padding: CGFloat = 4
        let contentSize = hostingView.intrinsicContentSize
        let containerSize = NSSize(width: contentSize.width + padding * 2, height: max(22, contentSize.height))
        let containerView = StatusBarContainerView(frame: NSRect(origin: .zero, size: containerSize))
        containerView.addSubview(hostingView)
        hostingView.frame = NSRect(
            x: padding,
            y: (containerSize.height - contentSize.height) / 2,
            width: contentSize.width,
            height: contentSize.height
        )

        button.addSubview(containerView)
        statusItem?.length = containerSize.width
    }
}

private final class StatusBarContainerView: NSView {
    override var allowsVibrancy: Bool { true }

    override func mouseDown(with event: NSEvent) {
        superview?.mouseDown(with: event)
    }

    override func mouseUp(with event: NSEvent) {
        superview?.mouseUp(with: event)
    }
}

private struct StatusBarGlyphView: View {
    let snapshot: StatusPanelSnapshot

    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(dotColor)
                .frame(width: 7, height: 7)

            Text("V")
                .font(.system(size: 13, weight: .bold, design: .rounded))
                .foregroundStyle(.primary)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(
            Capsule(style: .continuous)
                .fill(Color(nsColor: .windowBackgroundColor).opacity(0.88))
        )
        .fixedSize()
    }

    private var dotColor: Color {
        switch snapshot.helperTone {
        case .success:
            return .green
        case .warning:
            return .orange
        case .danger:
            return .red
        case .neutral:
            return .gray
        }
    }
}
