# Kuaishou QR Auth And HTTP Parser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Kuaishou QR-code login management and replace the server-side Kuaishou Chromium dependency with a pure HTTP parsing flow.

**Architecture:** Introduce a dedicated `kuaishou-auth` backend module that owns QR-code session exchange and cookie persistence, then inject it into `KuaishouParser` so parser detail fetching runs over GraphQL and HTML fallback instead of browser automation. Extend admin auth management and auth-health to treat Kuaishou as a first-class platform, then remove Chromium from the container/runtime defaults.

**Tech Stack:** NestJS, TypeORM, Jest, React, Axios, Docker Compose, shell tests

---

### Task 1: Lock Spec And Parser/Auth Test Coverage

**Files:**
- Create: `backend/src/kuaishou-auth/kuaishou-auth.service.spec.ts`
- Modify: `backend/src/parsers/kuaishou.parser.spec.ts`
- Modify: `backend/src/auth-health/auth-health.service.spec.ts`
- Create: `frontend/src/components/auth/KuaishouAuthPanel.test.tsx`
- Modify: `frontend/src/components/AdminAuthManagement.tsx`

- [ ] **Step 1: Write failing backend auth tests**
- [ ] **Step 2: Run targeted backend auth test command and verify failures**
- [ ] **Step 3: Write failing parser tests for cookie-backed HTTP detail fetching and HTML fallback**
- [ ] **Step 4: Run targeted parser tests and verify failures**
- [ ] **Step 5: Write failing frontend test for Kuaishou auth panel rendering**
- [ ] **Step 6: Run targeted frontend test and verify failures**

### Task 2: Implement Backend Kuaishou Auth Module

**Files:**
- Create: `backend/src/kuaishou-auth/kuaishou-auth.controller.ts`
- Create: `backend/src/kuaishou-auth/kuaishou-auth.module.ts`
- Create: `backend/src/kuaishou-auth/kuaishou-auth.service.ts`
- Create: `backend/src/kuaishou-auth/entities/kuaishou-auth-session.entity.ts`
- Create: `backend/src/kuaishou-auth/kuaishou-auth-cookie.util.ts`
- Modify: `backend/src/app.module.ts`

- [ ] **Step 1: Implement entity and cookie helper with minimal API required by tests**
- [ ] **Step 2: Implement service QR generation, polling, session persistence, and status queries**
- [ ] **Step 3: Implement controller endpoints and audit log integration**
- [ ] **Step 4: Register module in app wiring**
- [ ] **Step 5: Re-run targeted auth tests until green**

### Task 3: Replace Kuaishou Browser Parsing With HTTP Parsing

**Files:**
- Modify: `backend/src/parsers/kuaishou.parser.ts`
- Modify: `backend/src/parsers/parsers.module.ts`
- Modify: `backend/src/parsers/kuaishou.parser.spec.ts`

- [ ] **Step 1: Inject `KuaishouAuthService` into parser module wiring**
- [ ] **Step 2: Replace browser detail fetch with GraphQL HTTP fetch using stored cookie**
- [ ] **Step 3: Add HTML `__APOLLO_STATE__` fallback for empty GraphQL responses**
- [ ] **Step 4: Remove browser lifecycle code and Chromium executable resolution**
- [ ] **Step 5: Re-run targeted parser tests until green**

### Task 4: Extend Auth Health And Admin UI

**Files:**
- Modify: `backend/src/auth-health/entities/auth-health-status.entity.ts`
- Modify: `backend/src/auth-health/auth-health.service.ts`
- Modify: `backend/src/auth-health/auth-health.service.spec.ts`
- Modify: `frontend/src/components/auth/auth-management-shared.ts`
- Create: `frontend/src/components/auth/KuaishouAuthPanel.tsx`
- Create: `frontend/src/hooks/useKuaishouAuthManager.ts`
- Modify: `frontend/src/components/AdminAuthManagement.tsx`

- [ ] **Step 1: Extend auth-health platform enums and runtime status mapping**
- [ ] **Step 2: Add Kuaishou auth manager hook and panel component**
- [ ] **Step 3: Render Kuaishou health and QR flow in admin auth management page**
- [ ] **Step 4: Re-run targeted backend/frontend tests until green**

### Task 5: Remove Chromium Runtime Dependency

**Files:**
- Modify: `backend/Dockerfile`
- Modify: `docker-compose.yml`
- Modify: `scripts/deploy.sh`
- Modify: `scripts/dockerfile.test.sh`

- [ ] **Step 1: Remove Chromium package and Kuaishou Chrome env defaults**
- [ ] **Step 2: Update deployment defaults and shell assertions**
- [ ] **Step 3: Re-run script tests and Dockerfile checks**

### Task 6: Final Verification And Cleanup

**Files:**
- Modify: `backend/package.json`
- Modify: `backend/package-lock.json`
- Delete: `.playwright-mcp/*`
- Delete: `playwright-kuaishou-qr.json`

- [ ] **Step 1: Remove `puppeteer-core` if no longer referenced**
- [ ] **Step 2: Run focused backend Jest suites**
- [ ] **Step 3: Run focused frontend Vitest suites**
- [ ] **Step 4: Run build-level verification commands**
- [ ] **Step 5: Clean temporary research artifacts created in this session**
