# V-SAVE Companion

macOS-only native SwiftUI/AppKit menu bar helper for Douyin admin login. It exposes a localhost bridge, launches a dedicated Chrome profile, waits for Douyin login cookies through Chrome DevTools Protocol, and uploads them back to the backend bridge session.

## Scripts

- `npm run generate:icons` - render the SVG master into `AppIcon.appiconset` and `build/icon.png`
- `npm run generate:xcodeproj` - generate `VSaveCompanion.xcodeproj` from `project.yml`
- `npm run dev` - build the native app and open it
- `npm run build` - build the native macOS app with `xcodebuild`
- `npm test` - run native unit tests with `xcodebuild test`
- `npm run dist:mac` - build a Release `.app` bundle into `companion/release/`

## Local Endpoints

- `GET /health`
- `GET /login/current`
- `POST /login/start`

The helper binds only to `127.0.0.1:37219`.

## Runtime Notes

- The app runs as a native menu bar helper with a single SwiftUI/AppKit status panel.
- Left-clicking and right-clicking the menu bar icon both open the same status panel.
- The status panel shows helper state, bridge session, last error, open-at-login state, and restart/quit actions.
- Companion constants now live under `VSaveCompanion/Core/CompanionConfig.swift`.
- Use `CHROME_PROFILE_DIR` for the spec/display literal with `~`.
- Use `RESOLVED_CHROME_PROFILE_DIR` for runtime code that needs an absolute path.
- The helper creates and reuses a dedicated Chrome profile under:
  - `~/Library/Application Support/V-SAVE Companion/chrome-profile`
- Logs are written to:
  - `~/Library/Logs/V-SAVE Companion/bridge.log`

## Backend Origin Allowlist

By default the helper accepts:

- `https://...`
- `http://localhost`
- `http://127.0.0.1`

If the admin page runs on a non-HTTPS public host, set:

```bash
export V_SAVE_ALLOWED_BACKEND_ORIGINS="http://<your-public-host-or-ip>"
```

before launching the helper.

If frontend and backend are split across different origins, the helper should still receive the backend API origin. The current web client derives that origin from `VITE_API_BASE_URL`, not from `window.location.origin`.

## Third-Party Attribution

The menu bar structure and some styling patterns are adapted from [Quotio](https://github.com/nguyenphutrong/quotio), licensed under MIT. See `THIRD_PARTY_NOTICES.md` and `third_party/quotio/LICENSE`.
