# 组件设计规范（历史设计参考）

**Last Updated:** 2026-03-20  
**Status:** Archived（本文件保留早期组件拆分思路，不作为当前实现事实）

> 组件真实性能与交互以当前代码为准，优先参考 `frontend/src/components/*`、`mobile/src/components/*` 与当前事实文档。

## 1. 核心组件（当前实现映射）

1. `LinkInput`：链接输入与解析触发
2. `VideoPreview`：解析结果展示与弹窗预览
3. `FormatSelector`：格式 / 质量切换
4. `DownloadButton`：下载动作与状态
5. `DownloadHistory`：历史列表、筛选、清空、多选
6. `Notifications`：通知列表、全部已读、一键清空
7. `ConfirmDialog`：Web 统一危险操作确认弹层
8. `DownloadModeManagement`：后台下载模式配置（分端策略 + 折叠卡片）
9. `AdminRuntimeDashboard`：后台运行看板入口组件
10. `AuthQrCodeCard`：登录态二维码展示组件（页面内本地生成二维码）

## 2. 当前组件约束

### 2.1 DownloadHistory

- Web：支持平台 / 日期筛选、一键清空、分页、删除、重新下载
- iOS：支持平台 / 日期筛选、长按多选、全选、批量删除、一键清空、左滑删除

### 2.2 Notifications

- 双端支持“全部已读”与“一键清空”
- Web 登录态类通知“去处理”必须指向 `/admin?tab=auth`
- 通知受众遵循后端分流规则（内部登录态通知仅超管可见）

### 2.3 ConfirmDialog（Web）

- 作为复用组件统一替代原生 `window.confirm`
- 当前已用于下载历史清空与通知清空
- 后续新增危险操作优先复用该组件

### 2.4 DownloadModeManagement（Web Admin）

- 入口：`/admin?tab=download-policy`（仅 `SUPER_ADMIN`）
- 布局：可编辑 / 只读双分区，支持卡片折叠与全部展开 / 全部收起
- 可编辑平台：抖音、B站
- 只读平台：YouTube、快手、小红书
- 配置变更进入审计模块 `DOWNLOAD_POLICY`

### 2.5 Runtime 组件（Web Admin）

- 入口：`/admin?tab=runtime`
- 组成：指标带、趋势图、平台拆分、告警、Top 错误码、链路列表与详情抽屉
- 链路详情按阶段优先展示端侧记录，再展示接口记录
- 平台全链路接口耗时卡片默认展开，可折叠

## 3. 平台相关适配

- 抖音：风控场景错误码提示与二次确认回退
- B站：高画质依赖登录态，iOS 含 `iosCompatible` 智能首发
- 快手：预览优先兼容流，下载保持源档位策略
- YouTube：异步下载任务与 `yt-dlp` 依赖路径由后端配置层统一解析

## 4. 待补组件能力

1. 支付与订单组件
2. 下载任务队列可视化组件（异步任务）
3. 前端回归测试辅助组件（仅开发环境）

## 5. 当前应参考文档

- `README.md`
- `docs/plans/2026-03-20-development-status.md`
- `docs/plans/2026-03-20-project-architecture-summary.md`
- `docs/plans/2026-03-16-dual-platform-development-checklist.md`
