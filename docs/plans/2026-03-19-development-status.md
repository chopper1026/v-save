# Development Status Snapshot

> Archived on 2026-03-20. Latest snapshot: `docs/plans/2026-03-22-development-status.md`.

**Date:** 2026-03-19  
**Workspace:** `<repo-root>`  
**Branch:** `main`

> 本文档记录 2026-03-19 当天状态，仅用于回溯，不作为当前实施依据。

## 1. 当日结论

项目在 2026-03-19 时处于“Web 可用 Beta + Mobile v1 持续稳定性优化”阶段，双端共用同一后端 API；下载策略与端侧差异已开始统一收口到后台模式中心。

- Web 主链路：可用
- Backend 下载主链路：可用
- Mobile 主链路：可用
- Docker 本地联调：可用（默认复用宿主机 MySQL）
- 容器时区：统一 `Asia/Shanghai`

## 2. 当日已完成功能点（截至 2026-03-19）

### 2.1 Web（frontend）

- 登录 / 注册 / 用户中心 / 通知中心：可用
- 下载解析、格式与画质选择、下载历史：可用
- 管理后台：`/admin?tab=users|audit|auth|download-policy`（`SUPER_ADMIN`）
- 下载模式管理：
  - 支持平台维度 + 端侧维度（Web / Mobile）策略配置
  - 首版可编辑平台：抖音、B站；其余平台只读展示
  - 审计筛选支持 `DOWNLOAD_POLICY`
- 下载模式管理页 UI 重构：
  - 可编辑 / 只读双分区
  - 卡片可折叠，默认仅展开首个可编辑平台
  - 支持“全部展开 / 全部收起”
- Web 下载按钮进度：
  - 有 `Content-Length` 显示真实字节进度
  - 无 `Content-Length` 走平滑伪进度兜底

### 2.2 Backend（NestJS）

- 多平台解析：抖音 / B站 / 小红书 / 快手 / YouTube
- 下载主链路：`parse`、`get-url`、`create-task`、`tasks/:id`、`tasks/:id/file`、`merge`
- 下载模式中心：
  - 新增配置中心（按 `platform + clientType`）
  - 新增管理接口：
    - `GET /api/admin/download-modes/schema`
    - `GET /api/admin/download-modes/configs`
    - `PUT /api/admin/download-modes/configs/:platform/:clientType`
  - `POST /api/download/get-url` 强制要求 `clientType`
  - 审计模块新增 `DOWNLOAD_POLICY`
- 抖音链路优化（已落地）：
  - 解析并发槽位控制 + 解析结果缓存 / 去重
  - ratioProbe 分批探测与跨质量并发探测
  - ratioProbe 风控阈值保护（命中阈值后停止继续调度新质量）
- B站链路优化（已落地）：
  - 质量展开与映射阶段并发优化
- 代理稳定性优化（已落地）：
  - 连接超时与流空闲超时分离
  - Keep-Alive 复用与异常兜底

### 2.3 Mobile（Expo, iOS 优先）

- 登录 / 注册、自动登录恢复、401 失效处理：可用
- 首页解析：粘贴 / 剪贴板 / 分享扩展 / Deep Link：可用
- 预览下载、历史、通知、账户：可用
- 下载请求统一携带 `clientType=MOBILE`
- iOS 下载兼容策略：
  - B站智能首发 `iosCompatible`
  - 抖音首发无水印，命中特定错误码后二次确认回退
  - 相册不兼容自动重试一次 `iosCompatible=true`
- iOS 下载按钮进度修复：
  - 当系统无法提供总大小时，新增伪进度兜底

## 3. 当日未完成功能点

1. 支付网关与会员开通闭环未接入。  
2. Web 与 Mobile E2E 自动化尚未补齐。  
3. 下载链路可观测性（成功率、耗时、失败码）尚未形成稳定看板。  
4. 抖音代理在部分网络环境仍可能触发 IPv6 `ENETUNREACH`。  

## 4. 历史说明

- 当前事实与最新口径请参考 `docs/plans/2026-03-22-development-status.md`。
- 本文档中的后台入口、运行看板状态、开源前依赖清理状态均已被后续版本更新。
