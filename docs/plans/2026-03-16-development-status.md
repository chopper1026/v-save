# Development Status Snapshot

> Archived on 2026-03-18. Latest snapshot: `docs/plans/2026-03-22-development-status.md`.

**Date:** 2026-03-16  
**Workspace:** `<repo-root>`  
**Branch:** `main`

## 1. 当前结论

项目处于“Web 端可用 Beta + Mobile v1 持续打磨”阶段。  
本轮重点是移动端分享拉起稳定性、YouTube 下载链路一致性与文档同步。

- Web（前台/后台）主链路：可用
- Backend 核心下载接口：可用
- Mobile（iOS 优先）主链路：可用，存在平台编码兼容边界

## 2. 本轮完成（2026-03-16）

### 2.1 下载链路与后端

1. YouTube 异步高画质 selector 收紧，避免无约束 `best` 兜底导致“请求高画质但落低清”。
2. `GET /download/tasks/:id/file` 增加 `Content-Length`，移动端下载进度更稳定。

### 2.2 移动端（Expo）

1. 分享拉起自动解析链路完善：
- 兼容 `vsave://...` Deep Link 与分享扩展入口
- 增加自动解析去重，避免同一分享触发多次解析
- 增加首页自动解析期间禁用态（输入框、粘贴、解析按钮）

2. 预览下载页下载行为明确：
- 保持单次按用户所选画质下载，不做自动降档重试
- iOS 保存相册若遇编码不兼容，返回友好提示，不做服务端转码

## 3. 当前能力清单（按模块）

### 3.1 Web（frontend）

- 登录/注册/用户中心/通知中心：可用
- 下载解析与历史：可用
- 后台管理（用户、审计、登录态）：可用（`SUPER_ADMIN`）

### 3.2 Backend（NestJS）

- 多平台解析（抖音/B站/小红书/快手/YouTube）：可用
- 下载接口（get-url/create-task/tasks/file/merge）：可用
- 登录态健康检查与通知：可用

### 3.3 Mobile（React Native + Expo）

- 登录注册、自动登录恢复、401 失效回登录：可用
- 首页解析（粘贴/剪贴板/分享拉起）：可用
- 预览下载、历史、通知、账户：可用
- iOS 分享扩展与 Deep Link：可用

## 4. 已知限制与边界

1. iOS 相册兼容性：
- 部分 YouTube 视频编码可能不被 iOS 相册直接接收。
- 当前策略是提示用户“编码不兼容，暂不支持直接保存”，不进行服务端转码与自动降画质。

2. YouTube 4K 可用性：
- 若源站不可稳定获取目标画质，会返回明确失败信息（例如仅可用 480p）。

3. 首版范围未覆盖：
- 后台持续下载/断点续传
- 推送（APNs/FCM）
- 支付与会员开通闭环

## 5. 推荐下一步（优先级）

1. `P0` 增加移动端回归脚本：分享拉起、自动解析、预览下载、相册保存失败提示路径。
2. `P0` 统一跨端错误码文档（尤其下载与相册落地失败场景）。
3. `P1` 补充前端 E2E（Web + Mobile 核心链路）。
4. `P1` 下载链路可观测性：任务成功率、平均耗时、失败码分布。

## 6. 本次校验记录

1. `backend`: `npm test -- src/download/download.service.spec.ts` 通过（18/18）
2. `mobile`: `npm run typecheck` 通过
