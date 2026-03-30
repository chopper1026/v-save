# Development Status Snapshot

> Superseded on 2026-03-22. Latest snapshot: `docs/plans/2026-03-22-development-status.md`.

**Date:** 2026-03-20  
**Workspace:** `<repo-root>`  
**Branch:** `main`

> 本文档是当前开发现状主快照。历史状态文档仅用于回溯，不作为当前实施依据。

## 1. 当前结论

项目当前处于“Web 可用 Beta + Mobile v1 稳定性持续优化”阶段。

- Web 主链路：可用
- Backend 下载主链路：可用
- Mobile 主链路：可用
- 后台运行看板：可用
- Docker 本地联调：可用（默认复用宿主机 MySQL）
- 容器时区：统一 `Asia/Shanghai`

## 2. 当前已完成功能点（截至 2026-03-20）

### 2.1 Web（frontend）

- 登录、注册、登录态恢复
- 首页解析、预览、下载
- 下载历史：平台筛选、日期筛选、删除、批量删除、一键清空
- 通知中心：列表、单条已读、全部已读、一键清空
- 用户中心：资料维护、头像、手机号、密码、会员状态
- 管理后台：
  - 默认进入 `运行看板`
  - 左侧菜单顺序：运行看板 -> 下载模式管理 -> 登录态管理 -> 用户管理 -> 操作审计
  - `SUPER_ADMIN` 权限控制生效
- 运行看板：
  - 默认时间窗为“今日”
  - 60 秒自动刷新 + 手动立即刷新
  - 顶部指标带 + 登录态明细条带
  - 成功率趋势 / P95 趋势
  - 双端对比 / 平台拆分
  - 平台全链路接口耗时（默认展开，可折叠）
  - 链路详情抽屉支持按阶段查看，优先显示端侧记录，其次显示接口记录
- Runtime 模块按需懒加载，仅在 runtime tab 打开时加载图表与链路组件

### 2.2 Backend（NestJS）

- 多平台解析：抖音 / B站 / 小红书 / 快手 / YouTube
- 下载主链路：`parse`、`get-url`、`create-task`、`tasks/:id`、`tasks/:id/file`、`merge`
- 下载历史：筛选查询、单删、批量删除、条件清空
- 登录与账户：登录、注册、资料维护、密码修改、手机号绑定、会员状态
- 通知中心：列表、已读、全部已读、一键清空、登录态异常通知去重
- 平台登录态：B站扫码、抖音扫码/手动 Cookie、健康检查与通知联动
- 下载模式中心：按 `platform + clientType` 维护默认下载策略，后台可配置，写入审计
- Runtime 监控：
  - `runtime_feature_event`：能力事件
  - `runtime_interface_event`：接口与上游事件
  - 端侧/接口链路通过 `runtimeTraceId` 关联
  - 后台查询接口：`/api/admin/runtime-dashboard`、`/api/admin/runtime-dashboard/chains*`
  - 数据保留期 14 天，定时清理
- 开源前清理后的后端口径：
  - 下载链接绝对化策略：请求头优先 -> `PUBLIC_API_ORIGIN` -> 保留相对 `/api/...`
  - YouTube `noembed` 补充逻辑由 `YOUTUBE_NOEMBED_ENABLED` 控制，默认开启
  - Chrome / Chromium / `yt-dlp` 可执行路径解析已统一收口到配置模块

### 2.3 Mobile（Expo, iOS 优先）

- 登录、注册、自动登录恢复、401 失效处理
- 首页解析：粘贴 / 剪贴板 / 分享扩展 / Deep Link
- 预览与下载
- 下载历史：平台筛选、日期筛选、长按多选、全选、删除选中、一键清空
- 通知中心：列表、全部已读、一键清空
- 账户中心：头像、昵称、手机号、退出登录
- iOS 下载兼容策略：
  - B站智能首发兼容
  - 抖音无水印首发，必要时显式确认后允许水印回退
  - 相册不兼容（`PHPhotosErrorDomain 3301` / `IOS_PHOTOS_INCOMPATIBLE_CODEC`）友好提示 + 自动重试 `iosCompatible=true`
  - 无总大小场景走平滑伪进度
- Runtime 链路追踪：预览、下载、历史重下流程接入 `runtimeTraceId`

### 2.4 Docker 与联调

- 默认模式：`backend + frontend`
- 可选模式：`--profile with-mysql` 增加 MySQL 容器
- `backend` 与 `frontend` 均配置健康检查
- 仅 `backend/` 或 `frontend/` 改动时要求执行 `docker compose up -d --build`
- 仅 `mobile/` 或文档改动可跳过 Docker 重建

## 3. 双端兼容口径（当前）

1. `POST /api/download/get-url` 双端必须显式传 `clientType`。
2. Runtime 追踪字段（`runtimeTraceId` / `x-runtime-trace-id` / 代理 query 参数）变更必须双端同步验证。
3. 登录态、会员态、通知态、下载态改动必须提供双端联测证据。
4. 涉及分享拉起（Deep Link / 分享扩展）改动，必须验证去重与禁用态不回归。
5. App 保持“按用户所选画质单次下载”策略，不做隐式自动降档。
6. 当前端侧主动上报的 Runtime feature 范围为 `preview` / `download`，如新增 `parse` 口径，必须同步修改双端文档与接口校验。

## 4. 当前未完成项与风险

1. 支付网关与会员开通闭环未接入。  
2. Web 与 Mobile E2E 自动化尚未补齐。  
3. iOS 相册不兼容场景下，若“首轮失败后兼容重试成功”，链路可能只呈现最终成功，导致 Runtime 失败态低估。  
4. 抖音代理在部分网络环境仍可能出现 IPv6 `ENETUNREACH`，需要继续补充网络栈兜底。  
5. Web 与 Mobile 仍分别维护 API 类型与请求构造，尚未抽出 shared package，接口变更存在双端漂移风险。  
6. Web 与 Mobile 的账号能力覆盖尚未完全一致，Mobile 仍未承载 VIP 入口、密码修改、后台治理等管理能力。

## 5. 本轮关键新增点（便于回溯）

1. 运行看板完成顶部条带化布局与链路钻取交互落地。  
2. 链路详情按阶段优先展示端侧记录，再展示接口记录。  
3. 平台全链路接口耗时卡片移动到登录态条带上方，并支持折叠。  
4. Web 顶部“后台管理”入口与后台默认 tab 均调整为 `运行看板`。  
5. 二维码、占位图、字体与下载链接绝对化等开源前清理已同步落地。  
6. 历史 `mobile/design/` 设计资源已移除，当前移动端资源口径以 `mobile/assets/*` 为准。

## 6. 文档口径说明

- 当前事实文档：`README.md`、`docs/plans/2026-03-22-development-status.md`、`docs/plans/2026-03-22-project-architecture-summary.md`、`docs/plans/2026-03-22-docker-deployment-guide.md`
- 历史 `development-status` 与 `docker-deployment-plan` 文档仅用于回溯，不可作为当前开发依据
- 回归样例清单见 `各平台分享链接.md`，其“最近维护日期”不等于功能状态日期
