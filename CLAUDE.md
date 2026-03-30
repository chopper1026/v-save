# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 仓库级协作约束

- 所有对用户的回复使用中文。
- 这是四端单仓：`backend`（NestJS API）、`frontend`（Web）、`mobile`（Expo App）、`companion`（macOS 本机登录桥接）。
- 任何 API 字段、错误码、默认值调整，都要默认检查 Web + Mobile 双端影响。
- 抖音主链路依赖服务端登录态；双端需正确处理 `DOUYIN_SESSION_REQUIRED`，不要引入匿名降级主路径。
- 每次完成涉及 `backend/` 或 `frontend/` 的代码变更后，必须在仓库根目录执行 `docker compose up -d --build` 更新相关容器，并执行 `docker compose ps` 确认容器状态。

## 常用开发命令

### 1) 安装依赖

```bash
cd backend && npm install
cd ../frontend && npm install
cd ../mobile && npm install --legacy-peer-deps
cd ../companion && npm install
```

### 2) Backend（`backend/`）

```bash
npm run start:dev      # 开发
npm run build          # 构建
npm run lint           # ESLint
npm run test           # 单元测试（Jest）
npx jest src/download/download.service.spec.ts --runInBand   # 运行单个测试文件
```

> 说明：`package.json` 中有 `test:e2e`，但当前仓库未见 `backend/test/jest-e2e.json`，执行前先核对 e2e 配置是否已补齐。

### 3) Frontend（`frontend/`）

```bash
npm run dev            # 本地开发
npm run build          # 构建
npm run lint           # ESLint
npm run test           # Vitest 全量
npx vitest run src/hooks/useDouyinBridgeAuth.test.ts  # 运行单个测试文件
```

### 4) Mobile（`mobile/`）

```bash
npm run typecheck
npm run prebuild
npm run ios            # iOS 真机/模拟器（dev client）
npm run android
npm run start          # expo start --dev-client
```

- Mobile 当前 `package.json` 未定义统一 `npm test` 脚本；日常以 `typecheck + 真机回归` 为主。
- 联调时 `EXPO_PUBLIC_API_BASE_URL` 必须指向可被手机访问的后端地址（不要用 `localhost`）。

### 5) Companion（`companion/`）

```bash
npm run generate:xcodeproj
npm run dev
npm run build
npm test
npm run dist:mac
```

单测可按 xcodebuild 方式定向执行：

```bash
xcodebuild \
  -project companion/VSaveCompanion.xcodeproj \
  -scheme VSaveCompanion \
  -configuration Debug \
  -destination "platform=macOS" \
  -derivedDataPath companion/.derived-data \
  test -only-testing:VSaveCompanionTests/LocalBridgeRequestHandlerTests
```

### 6) Docker 联调（仓库根目录）

```bash
docker compose up -d --build
docker compose ps
docker compose --profile with-mysql up -d --build   # 使用 compose 内置 MySQL
```

- 默认编排 `backend + frontend`（mobile 不在 compose 内）。
- 变更触达 `backend/` 或 `frontend/` 后，按文档口径应重建容器。

## 高层架构（Big Picture）

### 后端：统一 API 与主业务编排

- 入口：`backend/src/main.ts`（全局 `/api` 前缀、CORS、全局校验、请求体限制）。
- 模块装配：`backend/src/app.module.ts`（Auth、Download、Parsers、DouyinAuth、RuntimeMonitor、Admin 等）。
- 下载主链路：`backend/src/download/download.controller.ts` + `backend/src/download/download.service.ts`
  - `parse -> get-url/create-task -> task/file/merge`
  - 控制器层显式处理 `clientType` 与 `x-runtime-trace-id`。
- Runtime 监控入口：`backend/src/runtime-monitor/runtime-events.controller.ts`（`POST /runtime/client-events`）。
- 抖音登录态管理：
  - `backend/src/douyin-auth/douyin-auth.controller.ts`
  - `backend/src/douyin-auth/douyin-auth.service.ts`
  - `backend/src/douyin-auth/douyin-bridge-auth.service.ts`
  - 负责桥接会话生命周期、uploadToken 校验、Cookie 入库与审计。

### Web：用户端 + 管理端

- 入口与路由：`frontend/src/main.tsx`、`frontend/src/App.tsx`。
- 首页解析主流程：`frontend/src/hooks/useVideoParser.ts`（调用 `/download/parse`，固定 `clientType='WEB'`，传 `x-runtime-trace-id`）。
- 下载/预览编排：`frontend/src/pages/Home.tsx`。
- API 与代理透传：`frontend/src/lib/api.ts`
  - axios 鉴权拦截
  - `toProxyUrl` 注入 `runtimeTraceId/runtimeStage/runtimeClientType`。
- 运行时埋点：`frontend/src/lib/runtime-monitor.ts`（feature 维度上报 parse/preview/download）。
- 抖音桥接管理端 UI：`frontend/src/hooks/useDouyinBridgeAuth.ts`、`frontend/src/components/auth/DouyinAuthPanel.tsx`。

### Mobile：Expo Router 端侧闭环

- App 壳：`mobile/app/_layout.tsx`（认证守卫、Deep Link/Share Intent 接入）。
- 解析入口：`mobile/app/(tabs)/home.tsx`（`/download/parse` + `clientType='MOBILE'` + trace header）。
- 预览/下载主流程：`mobile/app/preview.tsx`
  - 调用 `/download/get-url` 或 `/download/create-task`
  - iOS 兼容下载策略 + 抖音水印回退确认流。
- API 层：`mobile/src/lib/api.ts`（鉴权、代理参数、绝对 URL 归一化）。
- `clientType` 收口：`mobile/src/lib/download-request.ts`（统一构造 `clientType='MOBILE'`）。
- Runtime 埋点：`mobile/src/lib/runtime-telemetry.ts`。

### Companion：本机抖音扫码桥接（macOS）

- 应用入口：`companion/VSaveCompanion/App/VSaveCompanionApp.swift`（菜单栏 helper）。
- 编排核心：`companion/VSaveCompanion/Core/AppCoordinator.swift`
  - 启动本地 bridge
  - 拉起 Chrome 专用 profile
  - 收集 Cookie 并回传后端。
- 本地接口与来源校验：`companion/VSaveCompanion/Core/LocalBridgeRequestHandler.swift`
  - `GET /health`
  - `GET /login/current`
  - `POST /login/start`
- 配置与安全边界：`companion/VSaveCompanion/Core/CompanionConfig.swift`
  - 仅绑定 `127.0.0.1:37219`
  - backend origin allowlist 校验。
- 回传客户端：`companion/VSaveCompanion/Core/ServerSyncClient.swift`（`POST /api/douyin/auth/bridge/complete`）。

## 关键跨端链路

1. **解析 -> 预览 -> 下载**
   - 解析统一走 `/api/download/parse`，下载走 `/api/download/get-url`（或异步任务）。
2. **clientType 是强约束**
   - Web 传 `WEB`，Mobile 传 `MOBILE`；后端策略与统计依赖该字段。
3. **runtimeTraceId 贯穿链路**
   - 端侧通过 `x-runtime-trace-id` + 代理 query 参数贯穿，后端 Runtime 模块聚合链路事件。
4. **抖音 Bridge 流程**
   - Web 管理端 `bridge/start` -> Companion `login/start` -> 扫码拿 Cookie -> 后端 `bridge/complete`。

## 文档与事实来源

- 优先阅读：`README.md` 与 `docs/plans/README.md`。
- 涉及 API 契约、部署口径、双端检查项时，按 `docs/plans/README.md` 中“当前事实文档”与维护规则同步更新。