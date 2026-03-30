# V-SAVE 项目架构与功能现状梳理

**Date:** 2026-03-24
**Workspace:** `<repo-root>`

## 1. 项目整体架构

当前项目是一个“双端前台 + 单后端业务中台 + Web 后台治理 + 本机登录桥”的单仓库项目：

- `backend/`
  - NestJS + TypeORM + MySQL
  - 提供认证、解析、下载、通知、后台治理、运行监控与桥接登录会话 API
- `frontend/`
  - Vite + React + Tailwind + Zustand
  - 同时承载 Web 用户端与后台管理端
- `mobile/`
  - Expo + React Native + expo-router + Zustand
  - 承载移动端主链路（iOS 优先）
- `companion/`
  - Native macOS (`SwiftUI/AppKit`) + Chrome CDP
  - 仅面向管理员本机，负责抖音网页登录态管理的 Chrome 拉起、Cookie 捕获与服务端回传
- `docker-compose.yml`
  - 默认只编排 `backend + frontend`
  - `mobile/` 与 `companion/` 都不在 Docker 运行时内

## 2. 代码分层

### 2.1 后端模块

后端核心模块集中在 `backend/src/`：

- `auth/`：登录、注册、JWT、角色守卫
- `users/`：资料、手机号、密码、账号状态
- `download/`：解析后下载主链路、任务、历史、权限校验
- `parsers/`：抖音、B站、小红书、快手、YouTube 解析器
- `douyin-official/`：抖音官方详情接口、签名参数与会话依赖
- `douyin-quality/`：抖音解析结果装饰与质量状态兼容层
- `douyin-optimization/`：抖音候选级验证事实缓存
- `proxy/`：媒体代理转发、`play -> playwm` 水印回退、结构化错误
- `notifications/`：通知列表、已读、清空、去重
- `bilibili-auth/`：B 站扫码登录态管理
- `douyin-auth/`：抖音 bridge session、共享 Cookie 存储、手动 Cookie 维护
- `auth-health/`：登录态健康检查
- `download-mode/`：按 `platform + clientType` 管理默认下载策略
- `admin/`：用户治理、审计、下载模式后台入口
- `runtime-monitor/`：链路事件采集、运行看板、链路钻取
- `config/`：运行时配置、校验、公共路径解析
- `observability/`：接口耗时与运行链路的公共记录能力

说明：
- 旧的抖音服务端二维码浏览器、Xvfb、有头 Chromium 与协议级二维码复刻模块已移除。
- 当前后端不再承担抖音扫码浏览器运行环境，只承担 bridge session 和共享 Cookie 落库。

### 2.2 Web 入口与组件层

Web 核心入口在 `frontend/src/App.tsx`：

- `/`：首页解析与下载
- `/login`、`/register`
- `/user`
- `/admin`

当前后台管理页签顺序与默认行为：

1. `runtime`
2. `download-policy`
3. `auth`
4. `users`
5. `audit`

Web 当前主要复用组件包括：

- `ConfirmDialog.tsx`
- `DownloadHistory.tsx`
- `VideoPreview.tsx`
- `Header.tsx` + 通知共享状态
- `components/auth/*`
  - `AuthManagementPanel.tsx`
  - `BilibiliAuthPanel.tsx`
  - `DouyinAuthPanel.tsx`
  - `auth-management-shared.ts`
- `DownloadModeManagement.tsx`
- `AdminRuntimeDashboard.tsx`

说明：
- B 站登录态仍是传统服务端二维码模式。
- 抖音登录态已切到 bridge-first UI，不再展示服务端二维码登录入口。

### 2.3 Mobile 路由层

移动端基于 Expo Router：

- `mobile/app/(auth)/`：登录、注册
- `mobile/app/(tabs)/home.tsx`：首页解析
- `mobile/app/preview.tsx`：预览与下载
- `mobile/app/(tabs)/history.tsx`：下载历史
- `mobile/app/(tabs)/notifications.tsx`：通知中心
- `mobile/app/(tabs)/account.tsx`：账户中心
- `mobile/app/share.tsx`：分享落地页

移动端聚焦用户主链路，不承载后台治理能力，也不承载抖音登录态维护能力。

### 2.4 Companion 层

`companion/` 当前承担管理员本机抖音登录桥：

- 本地 bridge server：
  - `GET /health`
  - `GET /login/current`
  - `POST /login/start`
- Chrome 编排：
  - 查找本机 Google Chrome
  - 维护专用 profile
  - 使用 CDP 监听 Douyin 登录 Cookie
- 服务端回传：
  - `POST /api/douyin/auth/bridge/complete`

运行交互：

- 启动后隐藏 Dock，仅保留菜单栏入口
- 左键与右键都打开同一个中文状态面板
- 状态面板内统一承载 `开机自启`、`重启助手`、`退出助手`

## 3. 当前核心业务链路

### 3.1 通用解析与下载主链路

1. Web / Mobile 调用 `POST /api/download/parse`
2. 后端 `parsers/` 按平台选择解析器
3. 端侧进入预览并展示候选画质
4. 用户确认画质后调用 `POST /api/download/get-url`
5. 后端按 `platform + clientType` 的下载模式决定直链、代理、服务端合流或异步任务
6. Web / Mobile 按各自体验链路完成下载

### 3.2 抖音当前解析与下载链路

当前抖音已固定为“服务端 Cookie + 官方详情接口”的主链路：

1. 分享链接或长链接先解析到 `aweme_id`
2. `DouyinParser` 强制依赖服务端共享 Douyin Cookie
3. `DouyinOfficialDetailService` 生成 `msToken`
4. `DouyinSignatureService` 通过本地常驻 Python worker 生成 `a_bogus`
5. 服务端请求抖音官方 `aweme/detail`
6. 从官方响应构建完整质量集合、`videoCandidates`、`audioUrl`
7. 下载阶段在官方候选集合内按模式选流
8. 无有效会话时直接返回 `DOUYIN_SESSION_REQUIRED`

说明：
- 抖音正常主链路不再依赖匿名 detail、HTML 抽取、服务端二维码浏览器、协议级二维码复刻。
- 手动 Cookie 与 Companion Bridge 只服务于“如何维护服务端共享 Douyin Cookie”，不改变下载主链路。

### 3.3 抖音网页登录态管理链路

当前管理员维护共享 Douyin 登录态的主流程是：

1. Web 后台点击“扫码登录抖音”
2. `frontend` 请求 `POST /api/douyin/auth/bridge/start`
3. `frontend` 检测本机 `companion` 的 `GET /health`
4. `frontend` 请求本机 `POST /login/start`
5. `companion` 拉起本机 Chrome 专用 profile 到抖音官方登录页
6. 管理员用手机抖音 App 扫码确认
7. `companion` 捕获 `sessionid/sessionid_ss`
8. `companion` 调用 `POST /api/douyin/auth/bridge/complete`
9. `backend` 复用现有 `saveCookie()` 路径保存共享 Douyin Cookie
10. `frontend` 轮询 `GET /api/douyin/auth/bridge/status`，刷新状态为已配置

兜底路径：

- 当本机 helper 不可用或扫码链路异常时，管理员仍可手动粘贴 Cookie
- 手动 Cookie 仍写入同一份服务端共享 Douyin 登录态

## 4. 当前跨层基础设施

### 4.1 下载策略基础设施

- 下载策略由后端 `download-mode/` 模块按 `platform + clientType` 配置
- Web 与 Mobile 必须显式上报 `clientType`
- 抖音当前三种模式：
  - `QUALITY_FIRST`
  - `SPEED_FIRST`
  - `AVAILABILITY_FIRST`

### 4.2 Runtime 观测基础设施

- 端侧通过 `POST /api/runtime/client-events` 上报 `parse / preview / download` 事件
- 服务侧通过 `runtime_interface_event` 记录接口与上游耗时
- `runtimeTraceId` 贯穿：
  - `parse`
  - `get-url`
  - `proxy/fetch`
  - `create-task`
  - `tasks/:id`
  - App / Web 端侧事件

### 4.3 Docker 与可执行环境

- 默认 Docker 只运行 `backend + frontend`
- `backend` 镜像内置：
  - `ffmpeg`
  - `yt-dlp`
  - Chromium
  - Python venv + `gmssl`
  - `tools/douyin/abogus.py`
- `companion` 不进 Docker，不再要求云服务器或本地 Docker 提供 Xvfb、图形浏览器或服务端二维码环境

## 5. 当前能力覆盖

### 5.1 Backend 已落地

- 多平台解析：抖音、B站、小红书、快手、YouTube
- 下载主链路：
  - `POST /api/download/parse`
  - `POST /api/download/get-url`
  - `POST /api/download/create-task`
  - `GET /api/download/tasks/:id`
  - `GET /api/download/tasks/:id/file`
  - `GET /api/download/merge`
- 下载历史：查询、单删、批量删、条件清空
- 用户体系：登录/注册、资料编辑、密码修改、绑定手机号、账号状态
- 通知中心：列表、单条已读、全部已读、一键清空、登录态异常通知去重
- 平台登录态管理：
  - B站扫码
  - 抖音 Companion Bridge / 手动 Cookie
  - 健康检查
- 后台治理：用户管理、审计、下载模式管理
- Runtime 可观测性：客户端事件采集、接口/上游事件采集、后台运行看板与链路钻取

### 5.2 Web 已落地

- 首页解析、预览、下载
- 登录、注册、登录态恢复
- 用户中心：资料编辑、头像上传、密码修改、手机号绑定、下载历史、通知中心
- 后台管理：运行看板、下载模式管理、登录态管理、用户管理、操作审计
- 抖音登录态管理：bridge-first UI、Companion 可用性检测、共享 Cookie 手动兜底

### 5.3 Mobile 已落地

- 登录、注册、自动登录恢复
- 首页解析：粘贴、剪贴板、分享扩展、Deep Link
- 预览与下载
- 下载历史：平台筛选、日期筛选、单删、多选、批量删除、一键清空
- 通知中心：列表、全部已读、一键清空
- 账户中心：头像、昵称、手机号、退出登录
- iOS 兼容下载策略与 Runtime 追踪

### 5.4 Companion 已落地

- macOS 首发
- Chrome only
- 菜单栏 helper、状态卡片、重启/退出
- 本地 bridge server
- Chrome profile 管理
- CDP Cookie 监听
- 服务端回传与日志记录

## 6. 当前主要风险与改进空间

1. Companion App 仍缺真实抖音账号的完整端到端回归，当前不能把该链路标记为 fully verified。  
2. Windows helper 尚未开始，当前只支持 `macOS + Chrome`。  
3. Web 与 Mobile 仍分别维护 API 请求与部分类型，缺少 shared package。  
4. 支付闭环、双端 E2E 与 Runtime 失败态精度仍未闭环。  
5. 抖音能力仍强依赖服务端 Cookie、`a_bogus` 与官方字段稳定性，会话失效或签名漂移仍是核心运维风险。  
