# V-SAVE

多平台视频解析、预览、下载工具。

- 统一后端 API，覆盖 **Web 用户端 + 管理后台 + Mobile App**
- 提供 **macOS Companion** 作为抖音管理员登录桥接（本机 Chrome 扫码 -> 服务端共享会话）

## 项目状态（2026-03-24）

当前阶段：`Web Beta 可用 + Mobile v1 稳定性持续优化`

- 已完成：Web/Mobile 主链路、后台治理、通知中心、下载模式管理、Runtime 运行看板、Douyin Companion Bridge 基础设施
- 进行中：Web/Mobile E2E 自动化、Runtime 失败态精度补齐、Companion 实机扫码回归
- 强约束：任何 API 字段、错误码、默认值改动都要同步验证 **Web + Mobile**

## 核心能力

### 下载主链路

`parse -> preview -> get-url/create-task -> file/merge`

关键接口：

- `POST /api/download/parse`
- `POST /api/download/get-url`（必须传 `clientType=WEB|MOBILE`）
- `POST /api/download/create-task`
- `GET /api/download/tasks/:id`
- `GET /api/download/tasks/:id/file`
- `GET /api/download/merge`

### 抖音当前口径

- 解析依赖服务端会话（无匿名主路径）
- 官方详情链路：`msToken + a_bogus + aweme/detail`
- 无有效会话直接返回：`DOUYIN_SESSION_REQUIRED`
- 登录态管理主方案：`Companion App -> 本机 Chrome -> /api/douyin/auth/bridge/* -> 服务端 Cookie 入库`

## 仓库结构

| 目录 | 说明 | 技术栈 |
| --- | --- | --- |
| `backend/` | 认证、解析、下载、通知、后台治理、Runtime 监控 | NestJS + TypeORM + MySQL |
| `frontend/` | Web 用户端与管理后台 | Vite + React + Tailwind + Zustand |
| `mobile/` | 移动端主链路（iOS 优先） | Expo + React Native + expo-router + Zustand |
| `companion/` | macOS 本机登录桥接工具 | SwiftUI/AppKit + Chrome CDP |
| `docs/plans/` | 当前事实文档、历史设计与运维口径 | Markdown |

## 快速开始（源码开发）

### 1) 安装依赖

```bash
cd backend && npm install
cd ../frontend && npm install
cd ../mobile && npm install --legacy-peer-deps
cd ../companion && npm install
```

### 2) 启动 Backend + Frontend

```bash
cd backend
npm run start:dev

cd ../frontend
npm run dev
```

默认地址：

- Backend: `http://localhost:3001/api`
- Frontend: `http://localhost:3000`

### 3) 启动 Mobile（Expo dev client）

```bash
cd mobile
cp .env.example .env
npm run typecheck
npm run prebuild
npm run ios
# 或 npm run android
```

> Mobile 联调时，`EXPO_PUBLIC_API_BASE_URL` 需要指向手机可访问的后端地址（不要用 `localhost`）。

### 4) 启动 Companion（抖音扫码桥）

```bash
cd companion
npm run generate:xcodeproj
npm run dev
```

## Docker 本地联调

默认编排：`backend + frontend`（mobile 不在 compose 内）

```bash
docker compose up -d --build
docker compose ps
```

可选启用内置 MySQL：

```bash
docker compose --profile with-mysql up -d --build
```

默认访问：

- Web: `http://localhost:4871`
- Backend（给 Mobile）: `http://<LAN-IP>:3001/api`

## API 概览

### 认证

- `POST /api/auth/register`
- `POST /api/auth/login`

### 用户（需登录）

- `GET /api/users/profile`
- `PATCH /api/users/profile`
- `PATCH /api/users/account/password`
- `PATCH /api/users/account/phone`

### Runtime 事件（端侧）

- `POST /api/runtime/client-events`（`feature=parse|preview|download`）

### 抖音登录态管理（仅超级管理员）

- 状态/手动维护：
  - `GET /api/douyin/auth/status`
  - `POST /api/douyin/auth/session`
  - `DELETE /api/douyin/auth/session`
- Companion Bridge：
  - `POST /api/douyin/auth/bridge/start`
  - `GET /api/douyin/auth/bridge/status`
  - `POST /api/douyin/auth/bridge/complete`

## 双端开发约束（必须遵守）

1. Web 与 Mobile 共用 API，字段/错误码/默认值变更必须双端联测。
2. `POST /api/download/get-url` 双端必须显式传 `clientType=WEB|MOBILE`。
3. `runtimeTraceId` 与 `x-runtime-trace-id` 改动必须双端 + 后端同步验证。
4. 抖音链路不引入匿名降级主路径，必须正确处理 `DOUYIN_SESSION_REQUIRED`。
5. 登录态、通知态、下载态改动需提交双端联测证据。

## 测试与质量命令

### Backend

```bash
cd backend
npm run lint
npm run test
npx jest src/download/download.service.spec.ts --runInBand
```

### Frontend

```bash
cd frontend
npm run lint
npm run test
npx vitest run src/hooks/useDouyinBridgeAuth.test.ts
```

### Mobile

```bash
cd mobile
npm run typecheck
```

### Companion

```bash
cd companion
npm test
```

## 文档导航

- 文档索引：`docs/plans/README.md`
- 当前状态快照：`docs/plans/2026-03-24-development-status.md`
- 当前架构摘要：`docs/plans/2026-03-24-project-architecture-summary.md`
- Docker 联调指南：`docs/plans/2026-03-24-docker-deployment-guide.md`
- 双端开发检查清单：`docs/plans/2026-03-16-dual-platform-development-checklist.md`
- Mobile 专项说明：`mobile/README.md`

## License

[MIT](./LICENSE)
