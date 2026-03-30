# Development Status Snapshot

> Archived on 2026-03-18. Latest snapshot: `docs/plans/2026-03-22-development-status.md`.

**Date:** 2026-03-17  
**Workspace:** `<repo-root>`  
**Branch:** `main`

## 1. 当前结论

项目处于“Web 可用 Beta + Mobile v1 稳定性打磨”阶段，双端共用同一后端 API，且 Docker 本地联调基线已落地。

- Web 主链路：可用
- Backend 核心下载链路：可用
- Mobile 主链路：可用（iOS 下载兼容仍有边界场景）
- Docker 本地部署：可用（当前默认复用宿主机 MySQL）

## 2. 已完成能力（截至 2026-03-17）

### 2.1 Web（frontend）

- 登录/注册、用户中心、通知中心
- 下载解析、画质与格式选择、历史管理
- 管理后台（用户/审计/登录态）与 `SUPER_ADMIN` 权限控制
- `/admin/users` 兼容跳转至 `/admin?tab=users`
- 下载错误处理增强：`/api/proxy/fetch` 失败场景不再触发前端 `responseText` 读取异常

### 2.2 Backend（NestJS）

- 多平台解析：抖音 / B站 / 小红书 / 快手 / YouTube
- 下载主链路：`/api/download/parse`、`get-url`、`create-task`、`tasks/:id`、`tasks/:id/file`、`merge`
- 抖音下载一致性增强：
  - `get-url` 支持 `allowWatermarkFallback`（默认 `true`）
  - `proxy/fetch` 支持 `allowWatermarkFallback=0|1`
  - 抖音 `1080p/4k` 请求新增实测分辨率校验与返回 `actualQuality/actualWidth/actualHeight`
- CORS 支持 `CORS_ORIGINS` 环境变量逗号配置
- 端口支持 `PORT` 环境变量
- Docker 运行层内置 `ffmpeg`、`yt-dlp`、`chromium`
- iOS 兼容合流链路：`/api/download/merge?iosCompatible=1`（`libx264 + aac`）

### 2.3 Mobile（Expo）

- 登录注册、自动登录恢复、401 强制失效
- 首页解析（粘贴/剪贴板/分享扩展/Deep Link）
- 分享去重与自动解析禁用态
- 预览下载、历史、通知、账户
- YouTube 高画质异步任务流程（创建任务 + 轮询）
- iOS 保存失败自动重试 `iosCompatible` 链路

### 2.4 Docker 与联调

- `frontend`：`http://localhost:4871`
- `backend`：`http://localhost:3001`
- Compose 默认模式：`backend + frontend`，后端默认连 `host.docker.internal:3306`
- Compose 可选模式：`--profile with-mysql` 启用内置 MySQL
- `backend_tmp` 持久化卷已启用

## 3. iOS 下载策略现状（B站 vs 抖音）

### 3.1 B站

- 移动端支持“智能首发”：
  - 根据解析返回候选流比对默认流编码，默认候选 `codecid !== 7` 时首发 `iosCompatible=true`
  - 默认候选 `codecid === 7` 时首发普通链路
- 后端在 `iosCompatible=true` 时会优先从 B站候选流中选择 AVC（`codecid=7`）
- 若仍需分离音视频合流，走 `merge?iosCompatible=1` 服务端转码

### 3.2 抖音（当前）

- iOS 首发 `allowWatermarkFallback=false`，优先无水印线路
- 若后端返回 `DOUYIN_WATERMARK_FALLBACK_REQUIRED`，移动端弹二次确认，确认后再重试 `allowWatermarkFallback=true`
- 抖音 `1080p/4k` 请求会在后端做分辨率实测校验并按实测降档返回，避免“名义1080、实际720/576”
- 仅在 iOS 相册保存失败（例如 3302）后才触发 `iosCompatible=true` 转码重试

## 4. 未完成与进行中

1. 支付网关与会员开通闭环未接入（VIP 仍为站内流程）。
2. Web 与 Mobile 的 E2E 自动化未补齐。
3. 移动端复杂边界回归自动化待加强（分享拉起、相册失败路径）。
4. 下载链路可观测性（成功率、耗时、失败码）未形成稳定看板。

## 5. 双端开发执行口径（继续沿用）

1. API 契约改动必须同步验证 Web + Mobile（请求、响应、错误码、默认值）。
2. 登录态/会员态/通知态/下载态改动必须提供双端联测证据。
3. 涉及分享拉起链路改动必须验证去重逻辑和禁用态不回归。
4. App 仍保持“按用户所选画质单次下载”，不引入隐式自动降档。

## 6. 推荐下一步（优先级）

1. `P0` 补齐双端下载链路回归脚本（含 `/api/proxy/fetch` 失败场景、iOS 3302 场景）。
2. `P0` 沉淀跨端错误码与提示映射文档（下载失败、相册写入失败、任务过期）。
3. `P1` 补齐 Web 与 Mobile E2E 核心用例并纳入提测前必跑。
4. `P1` 建立下载链路基础监控（成功率、耗时、平台失败分布）。
