# Development Status Snapshot

> Archived on 2026-03-19. Latest snapshot: `docs/plans/2026-03-22-development-status.md`.

**Date:** 2026-03-18  
**Workspace:** `<repo-root>`  
**Branch:** `main`

> 本文档记录 2026-03-18 当天状态，仅用于回溯，不作为当前实施依据。

## 1. 当前结论

项目当前处于“Web 可用 Beta + Mobile v1 持续稳定性优化”阶段，双端共用同一后端 API，Docker 本地联调基线可用。

- Web 主链路：可用
- Backend 下载主链路：可用
- Mobile 主链路：可用
- Docker 本地部署：可用（默认复用宿主机 MySQL）
- 容器时区：已统一 `Asia/Shanghai`

## 2. 已完成功能点（截至 2026-03-18）

### 2.1 Web（frontend）

- 登录/注册/用户中心/通知中心：可用
- 下载解析、画质与格式选择、历史管理：可用
- 下载历史增强：
  - 平台筛选
  - 日期筛选（开始/结束）
  - 一键清空全部历史
- 通知中心增强：
  - 全部标记已读
  - 一键清空全部通知
  - 登录态类通知“去处理”正确跳转到 `/admin?tab=auth`
- 确认弹层统一：
  - 已抽离复用组件 `frontend/src/components/ConfirmDialog.tsx`
  - 通知与下载历史清空场景均已替换原生 `window.confirm`
- 管理后台（用户/审计/登录态）与 `SUPER_ADMIN` 权限：可用
- 浏览器标签图标：已切换为项目 Web logo（`/logo.svg`）

### 2.2 Backend（NestJS）

- 多平台解析：抖音 / B站 / 小红书 / 快手 / YouTube
- 下载主链路：`parse`、`get-url`、`create-task`、`tasks/:id`、`tasks/:id/file`、`merge`
- 下载历史增强：
  - `GET /api/download/history` 支持 `platform/dateFrom/dateTo`
  - `DELETE /api/download/history` 支持按筛选条件清空
  - `DELETE /api/download/history/batch` 支持按 `ids[]` 批量删除
- 抖音探测策略：后台模式中心支持 `probeMode=strict|smart|fast`，默认值按 `clientType` 下发，端侧仅保留一次性覆盖
- 抖音回退策略：`allowWatermarkFallback` + `DOUYIN_WATERMARK_FALLBACK_REQUIRED`
- 长视频代理下载优化：上游连接超时与流空闲超时分离管理
- 通知中心增强：
  - 新增 `DELETE /api/notifications/clear`
  - 通知类型与受众分流（内部登录态通知仅超管）
  - 登录态失效类通知去重：同平台存在未读同类通知时不重复发送，已读后允许继续发送

### 2.3 Mobile（Expo, iOS 优先）

- 登录/注册、自动登录恢复、401 失效处理：可用
- 首页解析：粘贴/剪贴板/分享扩展/Deep Link：可用
- 预览下载、历史、通知、账户：可用
- iOS Tabs 使用 `expo-router/unstable-native-tabs`
- 下载请求统一携带 `clientType=MOBILE`，默认下载策略由后台模式中心按端侧配置决定
- 下载历史增强：
  - 平台筛选
  - 日期筛选（全部/今天/近7天/近30天）
  - 一键清空全部历史
  - 长按进入多选、全选、删除选中
- 通知中心增强：
  - 全部已读
  - 一键清空
  - 一键清空按钮与“全部已读”同一操作行
- iOS 下载兼容策略：
  - B站智能首发 `iosCompatible`
  - 抖音首发仅在显式确认前禁用水印回退，命中特定错误码后二次确认
  - 相册不兼容（如 3302）自动重试一次 `iosCompatible=true`

### 2.4 品牌与图标口径

- Web 与 iOS logo 独立维护，不混用素材
- Web 浏览器标签图标：`frontend/public/logo.svg`
- iOS App 图标：`mobile/assets/icon.png`（系统通知图标随 App 图标口径）

### 2.5 Docker 与联调

- 默认模式：`backend + frontend`（后端连接 `host.docker.internal:3306`）
- 可选模式：`--profile with-mysql` 启用内置 MySQL
- `mysql/backend/frontend` 容器时区统一 `TZ=Asia/Shanghai`

## 3. 未完成功能点

1. 支付网关与会员开通闭环未接入。  
2. Web 与 Mobile E2E 自动化尚未补齐。  
3. 下载链路可观测性（成功率、耗时、失败码）未形成稳定看板。  
4. 抖音代理在部分网络环境仍可能触发 IPv6 `ENETUNREACH`，需继续补充网络栈兜底（如优先 IPv4）。

## 4. 双端兼容开发口径（强制）

1. API 契约改动必须同步验证 Web + Mobile（请求、响应、错误码、默认值）。
2. 登录态/会员态/通知态/下载态改动必须提供双端联测证据。
3. 分享拉起链路改动必须验证去重逻辑与禁用态不回归。
4. App 保持“按用户所选画质单次下载”策略，不做隐式自动降档。
5. 下载默认策略由后台模式中心按 `clientType` 接管，端侧仅保留显式的一次性覆盖参数。

## 5. 本轮关键新增点（便于回溯）

1. 下载历史：双端平台/日期筛选、双端一键清空、iOS 多选批量删除。
2. 通知中心：双端一键清空、Web/移动端交互位置优化。
3. 通知策略：超管内部通知隔离、登录态失效通知未读去重。
4. 下载策略：移动端请求携带 `clientType=MOBILE`，默认策略收口到后台模式中心，端侧仅保留显式重试覆盖。
5. Web 交互：统一确认弹层组件（后续 Web 危险操作统一复用）。
6. 品牌资源：Web favicon 切换为项目 logo，iOS 保持 App 图标口径。
