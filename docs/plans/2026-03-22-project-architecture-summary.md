# V-SAVE 项目架构与功能现状梳理

> Superseded on 2026-03-24. Latest summary: `docs/plans/2026-03-24-project-architecture-summary.md`.

**Date:** 2026-03-22  
**Workspace:** `<repo-root>`

## 1. 项目整体架构

当前项目是一个“双端前台 + 单后端业务中台 + Web 后台治理”的单仓库项目：

- `backend/`
  - NestJS + TypeORM + MySQL
  - 负责认证、解析、下载、通知、后台治理、运行监控
- `frontend/`
  - Vite + React + Tailwind + Zustand
  - 同时承载 Web 用户端与后台管理端
- `mobile/`
  - Expo + React Native + expo-router + Zustand
  - 承载移动端主链路（iOS 优先）
- `docker-compose.yml`
  - 默认编排 `backend + frontend`
  - `mobile/` 不在 Docker 运行时内
- `docs/plans/`
  - 保存当前事实文档、历史状态快照、设计参考与部署说明

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
- `bilibili-auth/`、`douyin-auth/`：平台登录态管理
- `auth-health/`：登录态健康检查
- `download-mode/`：按 `platform + clientType` 管理默认下载策略
- `admin/`：用户治理、审计、下载模式后台入口
- `runtime-monitor/`：链路事件采集、运行看板、链路钻取
- `config/`：运行时配置、校验、公共路径解析
- `observability/`：接口耗时与运行链路的公共记录能力

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
- `Header.tsx` + `useUnreadNotificationCount.ts` + `useNotificationStore.ts`：Web 通知角标共享状态
- `AdminAuthManagement.tsx`
- `DownloadModeManagement.tsx`
- `AdminRuntimeDashboard.tsx`
- `runtime/*` 运行看板子组件（折叠面板、偏好持久化、异常/错误码面板等）
- `AuthQrCodeCard.tsx`

### 2.3 Mobile 路由层

移动端基于 Expo Router：

- `mobile/app/(auth)/`：登录、注册
- `mobile/app/(tabs)/home.tsx`：首页解析
- `mobile/app/preview.tsx`：预览与下载
- `mobile/app/(tabs)/history.tsx`：下载历史
- `mobile/app/(tabs)/notifications.tsx`：通知中心
- `mobile/app/(tabs)/account.tsx`：账户中心
- `mobile/app/share.tsx`：分享落地页
- `mobile/app/_layout.tsx` + `mobile/src/components/launch-transition.tsx`：iOS 冷启动过渡
- `mobile/src/hooks/use-tab-scroll-to-top.ts` + `mobile/src/components/scroll-to-top-button.tsx`：iOS 长列表回顶能力

移动端聚焦用户主链路，不承载后台治理能力。

## 3. 当前核心业务链路

### 3.1 通用解析与下载主链路

1. Web / Mobile 都先调用 `POST /api/download/parse`
2. 后端 `parsers/` 按平台选择解析器
3. 前端或移动端进入预览页并展示候选画质
4. Mobile 预览不再只吃裸 URL，而是先基于 `downloadOptions.videoCandidates / merged / videoUrl` 规划结构化候选
5. iOS 端会优先选择更易播的候选：
  - Douyin：非水印代理候选优先
  - Bilibili：`proxy(merged mp4)` 优先，其次 AVC 候选
  - 首帧超时或长时间 buffering 时自动切下一条
6. 用户确认画质后调用 `POST /api/download/get-url`
7. 后端按 `platform + clientType` 的下载模式决定水印策略、校验强度与下载落地方式
8. 端侧直下、服务端代理、服务端合流或异步任务按平台能力分别执行

### 3.2 抖音当前解析链路

当前抖音已切换为“官方详情为唯一事实源”的主链路：

1. 分享链接或长链接先解析到 `aweme_id`
2. `DouyinParser` 强制获取服务端抖音 Cookie
3. `DouyinOfficialDetailService` 生成 `msToken`
4. `DouyinSignatureService` 通过本地常驻 Python worker 调 helper 生成 `a_bogus`
5. 服务端请求抖音官方 `aweme/detail` 接口
6. 从官方响应构建：
  - `title`
  - `cover`
  - `videoUrl`
  - `audioUrl`
  - `downloadOptions.merged`
  - `downloadOptions.videoCandidates`
7. 解析结果按 `videoId + sessionFingerprint` 缓存
8. 无有效会话时直接返回 `DOUYIN_SESSION_REQUIRED`

说明：
- 抖音主链路已不再依赖匿名 detail、HTML 抽取、`ratioProbe` 补画质、`yt-dlp` 补档位。
- `quality-status` 兼容接口仍保留，但 Douyin 正常路径不再依赖它补画质。

### 3.3 抖音当前下载选流链路

抖音 `get-url` 现在采用“官方候选直选 + 候选级验证缓存”的结构：

- 解析阶段会把官方候选建模到 `downloadOptions.videoCandidates`
- 下载阶段优先从官方候选集合中按请求画质选择
- 质量顺序遵循：
  - `exact`
  - `lower`
  - `higher`
- exact 质量存在时，不允许被更高档缓存或校验结果抬档
- `FAST / SMART / STRICT` 的差异主要体现在：
  - 是否立即返回
  - 是否做最小验证
  - 是否允许更严格的无水印前置判断
- 候选级优化缓存只记录验证事实：
  - `finalUrl`
  - `actualUrl`
  - `actualQuality`
  - `actualWidth / actualHeight`
  - `usedWatermarkFallback`
  - `verifiedAt`

### 3.4 抖音水印与 iOS 恢复链路

- `allowWatermarkFallback=false` 时，后端会先做最小预检
- 若确认只能走 `playwm`，直接返回 `DOUYIN_WATERMARK_FALLBACK_REQUIRED`
- iOS 非音频下载首发会先禁用水印回退
- 用户确认后，移动端会在当前预览页或历史页会话内自动续下
- 若原生下载阶段晚到命中水印问题，移动端会做一次同页重分类与恢复，避免“只能返回重解析”

## 4. 当前跨层基础设施

### 4.1 下载策略基础设施

- 下载策略由后端 `download-mode/` 模块按 `platform + clientType` 配置
- Web 与 Mobile 必须显式上报 `clientType`
- 端侧仅保留一次性覆盖参数，不固化平台默认策略
- 抖音当前三种模式：
  - `QUALITY_FIRST`
  - `SPEED_FIRST`
  - `AVAILABILITY_FIRST`

### 4.2 Runtime 观测基础设施

- 端侧通过 `POST /api/runtime/client-events` 上报 `parse / preview / download` 事件
- `preview` 事件当前额外包含：
  - `candidateCount`
  - `selectedCandidateIndex`
  - `failoverCount`
  - `selectedCandidateKind`
  - `selectedQuality`
- 服务侧通过 `runtime_interface_event` 记录接口与上游耗时
- `runtimeTraceId` 贯穿：
  - `parse`
  - `get-url`
  - `proxy/fetch`
  - `create-task`
  - `tasks/:id`
  - App / Web 端侧事件
- 后台运行看板会按三段 feature 展示成功率、P95、平台拆分和链路详情

### 4.3 Docker 与可执行环境

- 默认 Docker 只运行 `backend + frontend`
- `backend` 镜像内置：
  - `ffmpeg`
  - `yt-dlp`
  - Chromium
  - Python venv + `gmssl`
  - `tools/douyin/abogus.py`
- 抖音签名 helper 已固化进仓库与镜像，不依赖运行时远程下载脚本
- 运行态通过本地常驻 worker 复用 helper，而不是逐次起 Python 进程

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
- 平台登录态管理：B站扫码、抖音扫码/手动 Cookie、健康检查
- 后台治理：用户管理、审计、下载模式管理
- Runtime 可观测性：客户端事件采集、接口/上游事件采集、后台运行看板与链路钻取

### 5.2 Web 已落地

- 首页解析、预览、下载
- 登录、注册、登录态恢复
- 用户中心：资料编辑、头像上传、密码修改、手机号绑定、下载历史、通知中心
- 通知角标：Header 与通知页共享未读状态，操作后实时刷新
- VIP 页面（当前仍为站内激活态）
- 后台管理：运行看板、下载模式管理、登录态管理、用户管理、操作审计
- Runtime 看板：图表面板默认折叠、展开状态刷新持久化、异常与错误码面板宽布局

### 5.3 Mobile 已落地

- 登录、注册、自动登录恢复
- 首页解析：粘贴、剪贴板、分享扩展、Deep Link
- 预览与下载
- 下载历史：平台筛选、日期筛选、单删、多选、批量删除、一键清空
- 通知中心：列表、全部已读、一键清空
- 账户中心：头像、昵称、手机号、退出登录
- iOS 启动体验：透明 splash + Logo 过渡动画 + 首帧 safe-area 稳定兜底
- iOS 长列表体验：历史 / 通知悬浮回顶按钮，底部 tab 再次点击回到顶部
- 通知角标：共享 store 实时刷新；头部操作按钮文案固定、宽度固定，避免交互抖动
- iOS 兼容下载策略：
  - B站智能首发兼容
  - 结构化预览候选规划与自动切线
  - 抖音无水印首发与显式回退
  - 相册不兼容自动重试
  - 下载进度伪进度兜底

## 6. 当前主要风险与改进空间

1. 抖音能力当前强依赖服务端登录态与官方字段稳定性，会话失效或签名漂移是核心运维风险。  
2. `quality-status` 与 `enriching` 兼容层还在类型里保留，虽然 Douyin 主链路已基本退出，但认知成本仍在。  
3. Web 与 Mobile 仍分别维护 API 请求与部分类型，缺少 shared package。  
4. 支付闭环、双端 E2E 与 Runtime 失败态精度仍未闭环。  
5. 移动端与 Web 的账号能力覆盖仍不一致，后续若继续统一，需要单独规划。  

## 7. 文档基线

当前应优先参考：

1. `README.md`
2. `docs/plans/2026-03-22-development-status.md`
3. `docs/plans/2026-03-22-docker-deployment-guide.md`
4. `docs/plans/2026-03-16-dual-platform-development-checklist.md`
5. `mobile/README.md`

2026-03-20 及更早的状态快照仅用于回溯，不作为当前实现事实。
