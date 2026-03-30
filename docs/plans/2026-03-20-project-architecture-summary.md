# V-SAVE 项目架构与功能现状梳理

> Superseded on 2026-03-22. Latest summary: `docs/plans/2026-03-22-project-architecture-summary.md`.

**Date:** 2026-03-20  
**Workspace:** `<repo-root>`

## 1. 项目整体架构

当前项目是一个双端业务项目，包含：

- `backend/`
  - NestJS + TypeORM + MySQL
  - 提供认证、解析、下载、通知、后台治理、运行监控 API
- `frontend/`
  - Vite + React + Tailwind + Zustand
  - 承载 Web 用户端与后台管理端
- `mobile/`
  - Expo + React Native + expo-router + Zustand
  - 承载移动端主链路
- `docker-compose.yml`
  - 默认编排 `backend + frontend`
  - 可通过 `with-mysql` profile 增加 MySQL
- `docs/plans/`
  - 保存当前事实文档、历史状态快照、设计参考与部署说明

## 2. 代码分层

### 2.1 后端模块

后端核心模块集中在 `backend/src/`：

- `auth/`：登录、注册、JWT、角色守卫
- `users/`：资料、手机号、密码、会员状态
- `download/`：解析后下载主链路、任务、历史、权限校验
- `parsers/`：抖音、B站、小红书、快手、YouTube 解析器
- `proxy/`：媒体代理转发、上游兜底
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
- `/vip`
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
- `AdminAuthManagement.tsx`
- `DownloadModeManagement.tsx`
- `AdminRuntimeDashboard.tsx`
- `runtime/*` 运行看板子组件
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

移动端聚焦用户主链路，不承载后台治理能力。

## 3. 当前已落地能力

### 3.1 后端已落地

- 多平台解析：抖音、B站、小红书、快手、YouTube
- 下载主链路：
  - `POST /api/download/parse`
  - `POST /api/download/get-url`
  - `POST /api/download/create-task`
  - `GET /api/download/tasks/:id`
  - `GET /api/download/tasks/:id/file`
  - `GET /api/download/merge`
- 下载历史：查询、单删、批量删、条件清空
- 用户体系：登录/注册、资料编辑、密码修改、绑定手机号、会员状态
- 通知中心：列表、单条已读、全部已读、一键清空、登录态异常通知去重
- 平台登录态管理：B站扫码、抖音扫码/手动 Cookie、健康检查
- 后台治理：用户管理、审计、下载模式管理
- Runtime 可观测性：
  - 客户端事件采集
  - 接口/上游事件采集
  - 后台运行看板查询
  - 链路详情钻取
  - `runtimeTraceId` 链路贯通

### 3.2 Web 已落地

- 首页解析、预览、下载
- 登录、注册、登录态恢复
- 用户中心：
  - 资料编辑
  - 头像上传
  - 密码修改
  - 手机号绑定
  - 下载历史
  - 通知中心
- VIP 页面（当前仍为站内激活态）
- 后台管理：
  - 运行看板
  - 下载模式管理
  - 登录态管理
  - 用户管理
  - 操作审计
- 运行看板能力：
  - 指标带
  - 成功率趋势
  - P95 趋势
  - 双端/平台拆分
  - 单平台链路列表
  - 链路详情抽屉
- 当前复用组件沉淀方向：
  - 危险操作确认弹层
  - Runtime 面板与图表组件
  - 登录态二维码展示组件
  - 下载/预览相关基础组件

### 3.3 Mobile 已落地

- 登录、注册、自动登录恢复
- 首页解析：粘贴、剪贴板、分享扩展、Deep Link
- 预览与下载
- 下载历史：平台筛选、日期筛选、单删、多选、批量删除、一键清空
- 通知中心：列表、全部已读、一键清空
- 账户中心：头像、昵称、手机号、退出登录
- iOS 兼容下载策略：
  - B站智能首发兼容
  - 抖音无水印首发与显式回退
  - 相册不兼容友好提示与 `iosCompatible` 自动重试
  - 下载进度伪进度兜底
- Runtime 追踪：预览、下载、历史重下接入 `runtimeTraceId`

## 4. 当前跨层基础设施

### 4.1 下载策略基础设施

- 下载策略由后端 `download-mode/` 模块按 `platform + clientType` 配置
- Web 与 Mobile 必须显式上报 `clientType`
- 端侧仅保留一次性覆盖参数，不再固化默认策略

### 4.2 Runtime 观测基础设施

- 端侧通过 `POST /api/runtime/client-events` 上报 `preview` / `download` 事件
- 服务侧通过 `runtime_interface_event` 记录接口与上游耗时
- `runtimeTraceId` 贯穿：
  - `parse`
  - `get-url`
  - `proxy/fetch`
  - `create-task`
  - `tasks/:id`
  - App / Web 端侧事件

### 4.3 开源前清理后的依赖策略

- Web 二维码改为本地生成，不再依赖外部二维码服务
- Web 占位图改为仓库内本地资源
- Web 字体改为系统字体栈，不再请求 Google Fonts
- YouTube `noembed` 保留为可配置外部补充依赖，默认开启
- 下载链接绝对化新增 `PUBLIC_API_ORIGIN` 兜底
- Chrome / `yt-dlp` 路径解析统一从 `backend/src/config/executable-paths.ts` 提供
- `mobile/design/` 历史目录已删除，避免将设计草稿与运行时资源混放

## 5. 当前未闭环能力

### 5.1 明确未完成

- 支付闭环未接入
  - 当前没有支付模块、订单模块、支付回调模块
  - Web `VIPCenter` 仍是站内激活入口，不是正式支付闭环
- Web 与 Mobile E2E 自动化未落地
- Runtime 失败态精度仍有缺口
  - iOS “首轮失败、兼容重试成功”场景仍可能低估失败态
- 抖音代理网络兜底仍未彻底完成
  - 部分环境仍可能出现 IPv6 `ENETUNREACH`

### 5.2 双端覆盖不一致

- Web 有、Mobile 暂无：
  - VIP 开通入口
  - 密码修改
  - 超管后台
  - 登录态管理
  - 下载模式管理
  - Runtime 运行看板
- Backend 已提供但 Mobile 未完全接入：
  - `/users/account/password`
  - 超管治理相关接口

## 6. 当前主要架构风险

1. Web 与 Mobile 仍分别维护 `api.ts`、请求构造与部分类型，尚未抽出 shared package。  
2. 会员能力当前仍偏“系统内激活态”，距离生产支付闭环还有明显距离。  
3. 前端与移动端自动化测试不足，后续改动存在双端回归风险。  
4. 账号能力覆盖存在双端差异，若后续产品要求统一，需要明确优先级和实施顺序。  
5. 公开仓库后的运行配置仍依赖 `.env` 约束，部署文档必须持续与代码同步，否则容易误导后续开发。

## 7. 文档基线

当前应优先参考：

1. `README.md`
2. `docs/plans/2026-03-22-development-status.md`
3. `docs/plans/2026-03-22-docker-deployment-guide.md`
4. `docs/plans/2026-03-16-dual-platform-development-checklist.md`
5. `mobile/README.md`

历史 `development-status`、`docker-deployment-plan` 与 `video-downloader-ui/design/*` 仅用于回溯，不作为当前实现事实。
