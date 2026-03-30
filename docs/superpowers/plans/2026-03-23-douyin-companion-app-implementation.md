# Douyin Companion App Implementation Plan

> Historical note: this document records the original companion-app rollout plan. The current mainline implementation has since converged to the native macOS `VSaveCompanion` workspace under `companion/`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the unstable server-side Douyin QR login path with a macOS companion-app bridge that lets a `SUPER_ADMIN` start login from the web admin, complete the login in local Chrome, and save a shared server-side Douyin cookie for both Web and Mobile.

**Architecture:** The backend creates and tracks short-lived bridge auth sessions, the frontend starts and polls those sessions from the existing auth-management UI, and a new macOS companion app runs a localhost bridge that launches a dedicated Chrome profile, watches for Douyin login cookies via CDP, and uploads the result back to the backend over HTTPS. The existing manual-cookie fallback remains available, and the existing shared Douyin session storage remains the single source of truth for downloads.

**Tech Stack:** NestJS + TypeORM + MySQL, Vite + React + Vitest, native macOS helper (`SwiftUI/AppKit`) + Chrome CDP, Docker Compose for backend/frontend verification.

---

## File Structure

### Backend

- Create: `backend/src/douyin-auth/entities/douyin-bridge-auth-session.entity.ts`
  - Stores short-lived bridge login session metadata and upload-token hash.
- Create: `backend/src/douyin-auth/dto/start-douyin-bridge-auth.dto.ts`
  - Request/response typing for bridge session creation if DTO extraction is needed.
- Create: `backend/src/douyin-auth/dto/complete-douyin-bridge-auth.dto.ts`
  - Validates `authSessionId`, `uploadToken`, and `cookieHeader`.
- Create: `backend/src/douyin-auth/douyin-bridge-auth.service.ts`
  - Creates bridge sessions, advances statuses, validates uploads, persists success/failure.
- Create: `backend/src/douyin-auth/douyin-bridge-auth.service.spec.ts`
  - Covers session lifecycle and token validation.
- Modify: `backend/src/douyin-auth/douyin-auth.types.ts`
  - Add bridge status payloads for frontend/backend sharing.
- Modify: `backend/src/douyin-auth/douyin-auth.controller.ts`
  - Add `/bridge/start`, `/bridge/status`, `/bridge/complete`, optional `/bridge/helper-state`.
- Modify: `backend/src/douyin-auth/douyin-auth.service.ts`
  - Expose bridge-service entry points while preserving `saveCookie()`.
- Modify: `backend/src/douyin-auth/douyin-auth.module.ts`
  - Register the bridge entity/service.
- Modify: `backend/src/douyin-auth/douyin-auth.service.spec.ts`
  - Verify bridge methods delegate correctly and preserve manual-cookie behavior.
- Optional Modify: `backend/src/admin/admin-users.service.ts`
  - Reuse existing audit recording helpers if needed for new bridge actions.

### Frontend

- Create: `frontend/src/hooks/useDouyinBridgeAuth.ts`
  - Owns helper detection, bridge start, localhost handoff, status polling, and messages.
- Create: `frontend/src/hooks/useLocalCompanionAvailability.ts`
  - Small focused probe for `http://127.0.0.1:37219/health`.
- Create: `frontend/src/hooks/useDouyinBridgeAuth.test.ts`
  - Covers happy path and missing-helper path.
- Modify: `frontend/src/hooks/useDouyinAuthManager.ts`
  - Compose bridge flow with existing status/manual-cookie/clear-session flow.
- Modify: `frontend/src/components/auth/auth-management-shared.ts`
  - Add bridge status types and user-facing message helpers.
- Modify: `frontend/src/components/auth/DouyinAuthPanel.tsx`
  - Replace the current main QR flow with the bridge UX while keeping manual-cookie fallback collapsed.
- Modify: `frontend/src/components/auth/DouyinAuthPanel.test.tsx`
  - Update panel expectations for bridge-first UX.
- Modify: `frontend/src/components/AdminAuthManagement.tsx`
  - Pass through bridge flow state if needed, without duplicating logic.
- Modify: `frontend/src/pages/UserCenter.tsx`
  - Reuse the same bridge-driven Douyin panel state.

### Companion App

- Create: `companion/package.json`
  - Defines Electron app scripts, build scripts, and dependencies.
- Create: `companion/tsconfig.json`
  - TypeScript config for the helper app.
- Create: `companion/electron-builder.yml`
  - macOS app + DMG packaging config.
- Create: `companion/src/main.ts`
  - Electron app bootstrap and tray lifecycle.
- Create: `companion/src/app/config.ts`
  - Port, profile path, Chrome executable defaults, API domain allowlist.
- Create: `companion/src/app/types.ts`
  - Shared session and status types.
- Create: `companion/src/app/session-store.ts`
  - In-memory active bridge session state.
- Create: `companion/src/app/local-bridge-server.ts`
  - `health`, `start-login`, and local status endpoints.
- Create: `companion/src/app/chrome/chrome-locator.ts`
  - Resolves Google Chrome path on macOS.
- Create: `companion/src/app/chrome/chrome-launcher.ts`
  - Starts or reuses a controlled Chrome instance with a dedicated profile and remote debugging port.
- Create: `companion/src/app/chrome/douyin-login-watcher.ts`
  - Uses CDP/`puppeteer-core` to wait for `sessionid`/`sessionid_ss`.
- Create: `companion/src/app/server-sync-client.ts`
  - Uploads cookie to backend bridge completion endpoint.
- Create: `companion/src/app/logger.ts`
  - File/stdout logging for local debugging.
- Create: `companion/src/app/__tests__/session-store.test.ts`
  - Covers active-session replacement and expiry.
- Create: `companion/src/app/__tests__/server-sync-client.test.ts`
  - Covers token usage and API error handling.
- Create: `companion/README.md`
  - Local install, run, packaging, and troubleshooting notes.

### Docs

- Modify: `README.md`
  - Add companion-app login mode to current capability/deployment notes.
- Modify: `docs/plans/README.md`
  - Keep spec and implementation plan discoverable.
- Create or Modify: `docs/plans/2026-03-23-development-status.md`
  - Record that Douyin auth is moving to companion-app bridge.
- Create: `docs/plans/2026-03-23-douyin-companion-app-runbook.md`
  - Admin install/use/runbook for macOS first release.

## Task 1: Scaffold The Companion App Workspace

**Files:**
- Create: `companion/package.json`
- Create: `companion/tsconfig.json`
- Create: `companion/electron-builder.yml`
- Create: `companion/src/main.ts`
- Create: `companion/src/app/config.ts`
- Create: `companion/README.md`

- [ ] **Step 1: Add a failing smoke test target for the companion app package**

Create a minimal test command in `companion/package.json` that points to a not-yet-created test file, for example `vitest run src/app/__tests__/session-store.test.ts`.

- [ ] **Step 2: Run the companion app test command to verify the package is not scaffolded yet**

Run: `npm --prefix companion test`

Expected: FAIL with missing package or missing test file.

- [ ] **Step 3: Create the minimal Electron + TypeScript workspace**

Add:
- `package.json` with `dev`, `build`, `test`, `dist:mac`
- `tsconfig.json`
- `electron-builder.yml`
- `src/main.ts` that creates a tray-only app lifecycle without windows by default
- `src/app/config.ts` with constants:
  - `LOCAL_BRIDGE_PORT=37219`
  - `APP_NAME='V-SAVE Companion'`
  - `CHROME_PROFILE_DIR='~/Library/Application Support/V-SAVE Companion/chrome-profile'`

- [ ] **Step 4: Run the companion app test command again to verify the workspace is valid**

Run: `npm --prefix companion test`

Expected: PASS for the placeholder smoke test or PASS with zero real assertions after scaffolding.

- [ ] **Step 5: Commit**

```bash
git add companion/package.json companion/tsconfig.json companion/electron-builder.yml companion/src/main.ts companion/src/app/config.ts companion/README.md
git commit -m "feat: scaffold douyin companion app workspace"
```

## Task 2: Add Backend Bridge Session Types And Persistence

**Files:**
- Create: `backend/src/douyin-auth/entities/douyin-bridge-auth-session.entity.ts`
- Create: `backend/src/douyin-auth/douyin-bridge-auth.service.ts`
- Create: `backend/src/douyin-auth/douyin-bridge-auth.service.spec.ts`
- Modify: `backend/src/douyin-auth/douyin-auth.types.ts`
- Modify: `backend/src/douyin-auth/douyin-auth.module.ts`

- [ ] **Step 1: Write failing bridge-session service tests**

Cover:
- creating a bridge session returns `authSessionId`, `expiresAt`, `uploadToken`
- creating a new session expires the previous active session
- stored upload token is hashed, not persisted in plain text
- completing an expired session fails

- [ ] **Step 2: Run the backend test file to verify it fails**

Run: `npm --prefix backend test -- douyin-bridge-auth.service.spec.ts --runInBand`

Expected: FAIL because the service/entity do not exist.

- [ ] **Step 3: Implement the entity, status types, and minimal bridge service**

Implement:
- `DouyinBridgeAuthSession` entity with status enum and timestamps
- bridge session create/get/expire helpers
- upload token generation using a random opaque secret and a one-way hash
- bridge payload types in `douyin-auth.types.ts`

- [ ] **Step 4: Run the backend test file to verify it passes**

Run: `npm --prefix backend test -- douyin-bridge-auth.service.spec.ts --runInBand`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/douyin-auth/entities/douyin-bridge-auth-session.entity.ts backend/src/douyin-auth/douyin-bridge-auth.service.ts backend/src/douyin-auth/douyin-bridge-auth.service.spec.ts backend/src/douyin-auth/douyin-auth.types.ts backend/src/douyin-auth/douyin-auth.module.ts
git commit -m "feat: add douyin bridge auth session model"
```

## Task 3: Expose Backend Bridge APIs And Reuse Cookie Save Logic

**Files:**
- Create: `backend/src/douyin-auth/dto/complete-douyin-bridge-auth.dto.ts`
- Modify: `backend/src/douyin-auth/douyin-auth.controller.ts`
- Modify: `backend/src/douyin-auth/douyin-auth.service.ts`
- Modify: `backend/src/douyin-auth/douyin-auth.service.spec.ts`
- Test: `backend/src/douyin-auth/douyin-bridge-auth.service.spec.ts`

- [ ] **Step 1: Write failing controller/service tests for bridge endpoints**

Cover:
- `POST /bridge/start` returns a session payload
- `GET /bridge/status` returns the current bridge session state
- `POST /bridge/complete` validates token and calls existing `saveCookie()` path
- audit events fire for start and confirmed completion

- [ ] **Step 2: Run the backend Douyin auth tests to verify failure**

Run: `npm --prefix backend test -- douyin-auth.service.spec.ts douyin-bridge-auth.service.spec.ts --runInBand`

Expected: FAIL because controller/service methods are missing.

- [ ] **Step 3: Implement the bridge endpoints and service delegation**

Implement:
- controller routes:
  - `POST /douyin/auth/bridge/start`
  - `GET /douyin/auth/bridge/status`
  - `POST /douyin/auth/bridge/complete`
- service methods:
  - `startBridgeAuth()`
  - `getBridgeAuthStatus(authSessionId)`
  - `completeBridgeAuth(payload)`
- in `completeBridgeAuth()`, call existing `saveCookie()` after token validation

- [ ] **Step 4: Run the backend tests and backend build**

Run:
- `npm --prefix backend test -- douyin-auth.service.spec.ts douyin-bridge-auth.service.spec.ts --runInBand`
- `npm --prefix backend run build`

Expected: PASS and successful build.

- [ ] **Step 5: Commit**

```bash
git add backend/src/douyin-auth/dto/complete-douyin-bridge-auth.dto.ts backend/src/douyin-auth/douyin-auth.controller.ts backend/src/douyin-auth/douyin-auth.service.ts backend/src/douyin-auth/douyin-auth.service.spec.ts
git commit -m "feat: expose douyin bridge auth endpoints"
```

## Task 4: Build The Frontend Bridge State Machine

**Files:**
- Create: `frontend/src/hooks/useLocalCompanionAvailability.ts`
- Create: `frontend/src/hooks/useDouyinBridgeAuth.ts`
- Create: `frontend/src/hooks/useDouyinBridgeAuth.test.ts`
- Modify: `frontend/src/components/auth/auth-management-shared.ts`
- Modify: `frontend/src/hooks/useDouyinAuthManager.ts`

- [ ] **Step 1: Write failing frontend hook tests**

Cover:
- helper offline => returns install/start guidance
- helper online => starts bridge flow and polls backend status
- `confirmed` => triggers auth status refresh
- `failed/expired` => surfaces backend error message

- [ ] **Step 2: Run the failing frontend test**

Run: `npm --prefix frontend test -- useDouyinBridgeAuth.test.ts`

Expected: FAIL because the hook does not exist.

- [ ] **Step 3: Implement the bridge hook and helper availability probe**

Implement:
- `useLocalCompanionAvailability()`
- `useDouyinBridgeAuth()` with:
  - backend `bridge/start`
  - local helper `health`
  - local helper `start-login`
  - backend `bridge/status` polling
- merge with `useDouyinAuthManager()` without duplicating the existing manual-cookie logic

- [ ] **Step 4: Run the frontend bridge-hook test**

Run: `npm --prefix frontend test -- useDouyinBridgeAuth.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useLocalCompanionAvailability.ts frontend/src/hooks/useDouyinBridgeAuth.ts frontend/src/hooks/useDouyinBridgeAuth.test.ts frontend/src/components/auth/auth-management-shared.ts frontend/src/hooks/useDouyinAuthManager.ts
git commit -m "feat: add douyin bridge auth frontend state machine"
```

## Task 5: Switch The Web Auth Panel To Bridge-First UX

**Files:**
- Modify: `frontend/src/components/auth/DouyinAuthPanel.tsx`
- Modify: `frontend/src/components/auth/DouyinAuthPanel.test.tsx`
- Modify: `frontend/src/components/AdminAuthManagement.tsx`
- Modify: `frontend/src/pages/UserCenter.tsx`

- [ ] **Step 1: Write/update failing panel tests for the new UX**

Cover:
- primary CTA becomes “扫码登录抖音”
- when helper is missing, panel shows install/start instructions instead of server QR code
- manual Cookie remains available under advanced fallback
- success state still updates shared status display in both admin and user center

- [ ] **Step 2: Run the panel test to verify it fails**

Run: `npm --prefix frontend test -- DouyinAuthPanel.test.tsx`

Expected: FAIL because the panel still expects the old QR flow.

- [ ] **Step 3: Implement the bridge-first panel changes**

Implement:
- remove server-rendered Douyin QR code as the default path
- add helper availability messaging
- keep manual Cookie UI collapsed
- wire both `AdminAuthManagement` and `UserCenter` through the same panel contract

- [ ] **Step 4: Run the panel test and frontend build**

Run:
- `npm --prefix frontend test -- DouyinAuthPanel.test.tsx`
- `npm --prefix frontend run build`

Expected: PASS and successful build.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/auth/DouyinAuthPanel.tsx frontend/src/components/auth/DouyinAuthPanel.test.tsx frontend/src/components/AdminAuthManagement.tsx frontend/src/pages/UserCenter.tsx
git commit -m "feat: switch douyin auth ui to companion bridge flow"
```

## Task 6: Implement The Companion App Local Bridge Server

**Files:**
- Create: `companion/src/app/types.ts`
- Create: `companion/src/app/session-store.ts`
- Create: `companion/src/app/local-bridge-server.ts`
- Create: `companion/src/app/__tests__/session-store.test.ts`

- [ ] **Step 1: Write failing companion session-store tests**

Cover:
- one active local login session at a time
- replacing a session marks the previous one failed/expired locally
- helper can report current status to the webpage

- [ ] **Step 2: Run the failing companion tests**

Run: `npm --prefix companion test -- session-store.test.ts`

Expected: FAIL because the files do not exist.

- [ ] **Step 3: Implement the in-memory store and localhost server**

Implement local endpoints:
- `GET /health`
- `POST /login/start`
- `GET /login/current`

Rules:
- bind only to `127.0.0.1`
- reject requests without an allowed backend origin marker
- keep the active session only in memory

- [ ] **Step 4: Run the companion tests**

Run: `npm --prefix companion test -- session-store.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add companion/src/app/types.ts companion/src/app/session-store.ts companion/src/app/local-bridge-server.ts companion/src/app/__tests__/session-store.test.ts
git commit -m "feat: add local bridge server for douyin companion app"
```

## Task 7: Implement Chrome Launch And Douyin Login Watching

**Files:**
- Create: `companion/src/app/chrome/chrome-locator.ts`
- Create: `companion/src/app/chrome/chrome-launcher.ts`
- Create: `companion/src/app/chrome/douyin-login-watcher.ts`
- Modify: `companion/src/main.ts`

- [ ] **Step 1: Write failing tests or smoke assertions for Chrome path resolution and login watcher contract**

Cover:
- locator returns the standard macOS Chrome path or a clear error
- launcher builds a dedicated-profile command line
- watcher reports success only when `sessionid` or `sessionid_ss` is present

- [ ] **Step 2: Run the companion test command to verify the new tests fail**

Run: `npm --prefix companion test`

Expected: FAIL due to missing Chrome modules.

- [ ] **Step 3: Implement Chrome orchestration**

Implement:
- locate `/Applications/Google Chrome.app/...`
- spawn Chrome with:
  - `--user-data-dir=<helper profile dir>`
  - `--remote-debugging-port=<free port>`
  - Douyin login URL
- connect via `puppeteer-core` or raw CDP
- poll `Browser.getCookies`/page cookies for `sessionid`/`sessionid_ss`

- [ ] **Step 4: Run the companion tests**

Run: `npm --prefix companion test`

Expected: PASS for unit-level coverage.

- [ ] **Step 5: Commit**

```bash
git add companion/src/app/chrome/chrome-locator.ts companion/src/app/chrome/chrome-launcher.ts companion/src/app/chrome/douyin-login-watcher.ts companion/src/main.ts
git commit -m "feat: add chrome orchestration for douyin companion app"
```

## Task 8: Upload Cookies Back To The Backend And Complete The Flow

**Files:**
- Create: `companion/src/app/server-sync-client.ts`
- Create: `companion/src/app/__tests__/server-sync-client.test.ts`
- Modify: `companion/src/app/local-bridge-server.ts`
- Modify: `companion/src/app/session-store.ts`
- Test: `backend/src/douyin-bridge-auth.service.spec.ts`

- [ ] **Step 1: Write failing sync-client tests**

Cover:
- successful upload marks the local session `confirmed`
- backend rejection marks the local session `failed`
- upload always sends `authSessionId`, `uploadToken`, and `cookieHeader`

- [ ] **Step 2: Run the failing companion tests**

Run: `npm --prefix companion test -- server-sync-client.test.ts`

Expected: FAIL because the upload client does not exist.

- [ ] **Step 3: Implement backend completion upload and local status transitions**

Implement:
- `server-sync-client.ts`
- wire watcher success into upload
- update the local session store:
  - `waiting_scan`
  - `scanned`
  - `uploading`
  - `confirmed`
  - `failed`

- [ ] **Step 4: Run companion tests and backend bridge tests**

Run:
- `npm --prefix companion test -- server-sync-client.test.ts`
- `npm --prefix backend test -- douyin-bridge-auth.service.spec.ts --runInBand`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add companion/src/app/server-sync-client.ts companion/src/app/__tests__/server-sync-client.test.ts companion/src/app/local-bridge-server.ts companion/src/app/session-store.ts
git commit -m "feat: complete douyin companion bridge upload flow"
```

## Task 9: Update Docs, Runbooks, And Current Facts

**Files:**
- Modify: `README.md`
- Modify: `docs/plans/README.md`
- Create or Modify: `docs/plans/2026-03-23-development-status.md`
- Create: `docs/plans/2026-03-23-douyin-companion-app-runbook.md`
- Modify: `companion/README.md`

- [ ] **Step 1: Write the missing documentation assertions as a checklist**

Checklist:
- README mentions companion-app login mode
- runbook explains install/start/login flow
- current status snapshot records the migration away from server QR login

- [ ] **Step 2: Update the documents**

Document:
- admin prerequisites
- macOS install/start flow
- local helper port and troubleshooting
- cloud deployment impact: server no longer needs Douyin login browser stack

- [ ] **Step 3: Verify document links and formatting**

Run:
- `rg -n "companion|bridge/start|V-SAVE Companion" README.md docs companion/README.md`
- `git diff --check`

Expected: references found, no diff-format issues.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/plans/README.md docs/plans/2026-03-23-development-status.md docs/plans/2026-03-23-douyin-companion-app-runbook.md companion/README.md
git commit -m "docs: add douyin companion app rollout guidance"
```

## Task 10: End-To-End Verification And Docker Sync

**Files:**
- Modify as needed based on verification fallout from prior tasks.

- [ ] **Step 1: Run focused backend tests**

Run:
- `npm --prefix backend test -- douyin-auth.service.spec.ts douyin-bridge-auth.service.spec.ts --runInBand`

Expected: PASS.

- [ ] **Step 2: Run focused frontend tests**

Run:
- `npm --prefix frontend test -- useDouyinBridgeAuth.test.ts DouyinAuthPanel.test.tsx`

Expected: PASS.

- [ ] **Step 3: Run companion app tests**

Run:
- `npm --prefix companion test`

Expected: PASS.

- [ ] **Step 4: Run production builds**

Run:
- `npm --prefix backend run build`
- `npm --prefix frontend run build`
- `npm --prefix companion run build`

Expected: all builds succeed.

- [ ] **Step 5: Rebuild Docker for backend/frontend changes**

Run:
- `docker compose up -d --build backend frontend`
- `docker compose ps`

Expected: backend/frontend healthy.

- [ ] **Step 6: Perform local bridge smoke test**

Manual path:
- start backend/frontend locally
- start companion app locally
- open网页登录态管理
- verify helper detection
- verify Chrome launches
- complete Douyin scan
- confirm `GET /api/douyin/auth/status` reports `hasCookie: true`

- [ ] **Step 7: Commit any final verification fixes**

```bash
git add -A
git commit -m "test: verify douyin companion bridge end to end"
```

## Notes For Execution

- Do not remove the manual Douyin Cookie fallback during this plan.
- Do not keep investing in the old server-side Douyin QR login as a primary path.
- Keep Web and Mobile compatibility intact by continuing to store only one shared server-side Douyin session.
- If the companion app needs a backend base URL override for local/dev/prod, implement it in companion config rather than hardcoding domains.
- For macOS release packaging, defer notarization automation until the basic login flow works locally, but do not merge without documenting the manual notarization path.
