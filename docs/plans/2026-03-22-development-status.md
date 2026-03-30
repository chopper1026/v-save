# Development Status Snapshot

> Superseded on 2026-03-24. Latest snapshot: `docs/plans/2026-03-24-development-status.md`.

**Date:** 2026-03-22  
**Workspace:** `<repo-root>`  
**Branch:** `main`

> 本文档是 2026-03-22 当前开发现状主快照。2026-03-20 及更早的状态文档仅用于回溯，不作为当前实施依据。

## 1. 当前结论

项目当前处于“Web Beta 可用 + Mobile v1 稳定性持续优化”阶段，抖音平台已完成从匿名解析过渡到“服务端会话 + `a_bogus/msToken` + 官方详情接口”的主链路收敛。

- Web 主链路：可用
- Backend 下载主链路：可用
- Mobile 主链路：可用
- 后台运行看板：可用
- Docker 本地联调：可用（默认复用宿主机 MySQL）
- 抖音官方解析链路：可用，且已支持 4K / 1440p / 1080p / 720p / 540p 等完整档位建模

## 2. 当前已完成功能点（截至 2026-03-22）

### 2.1 Web（frontend）

- 登录、注册、登录态恢复
- 首页解析、预览、下载
- 下载历史：平台筛选、日期筛选、删除、批量删除、一键清空
- 通知中心：列表、单条已读、全部已读、一键清空
- 通知角标：Header 与通知页共享未读状态，单条已读 / 全部已读 / 清空后实时刷新
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
  - 平台全链路接口耗时
  - 成功率趋势 / P95 趋势 / 双端对比 / 平台拆分四个图表面板默认折叠，刷新后记住展开状态
  - 异常警告与 Top 错误码采用更宽布局，适合大数据量展示
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
  - `runtime_feature_event`：端侧能力事件，当前 feature 范围为 `parse | preview | download`
  - `runtime_interface_event`：接口与上游事件
  - 端侧/接口链路通过 `runtimeTraceId` 关联
  - `preview` 事件当前额外记录 `candidateCount / selectedCandidateIndex / failoverCount / selectedCandidateKind / selectedQuality`
  - 后台查询接口：`/api/admin/runtime-dashboard`、`/api/admin/runtime-dashboard/chains*`
  - 数据保留期 14 天，定时清理
- 抖音当前主链路：
  - 分享链接仅负责解析到 `aweme_id`
  - 随后强依赖服务端抖音 Cookie
  - 使用 `msToken + a_bogus` 请求官方 `aweme/detail` 接口
  - `a_bogus` 由本地 `abogus.py` 通过常驻 Python worker 生成，不再按请求重复拉起 Python，也不存在运行时 GitHub 在线拉取
  - `title / cover / videoUrl / audioUrl / downloadOptions / videoCandidates` 均以官方响应为准
  - 下载时只在官方候选集合内选流，并结合候选级校验缓存与水印前置判断
  - 无有效抖音会话时直接返回 `DOUYIN_SESSION_REQUIRED`
- 代理与媒体兼容：
  - `douyinvod.com` 已纳入抖音媒体域识别
  - 对 `.mp4 / .m4s` 且上游误报 `application/octet-stream` 的响应，会规范成 `video/mp4`
  - 旧抖音 `aweme/v1/play` 跳转链已尽量收敛到 `douyinvod.com` 直链，降低容器内 `ENOTFOUND` 风险

### 2.3 Mobile（Expo, iOS 优先）

- 登录、注册、自动登录恢复、401 失效处理
- 首页解析：粘贴 / 剪贴板 / 分享扩展 / Deep Link
- 预览与下载
- 下载历史：平台筛选、日期筛选、长按多选、全选、删除选中、一键清空
- 通知中心：列表、全部已读、一键清空
- 历史 / 通知：长列表回到顶部悬浮按钮，且 iOS 底部 tab 选中状态再次点击也会回到顶部
- 账户中心：头像、昵称、手机号、退出登录
- iOS 冷启动体验：
  - 原生 splash 与当前磨砂播放 logo 对齐
  - JS 冷启动过渡动画接棒，无旧 `VS` 图与中间白底 loading 闪断
  - 首帧 safe-area 采用稳定兜底，避免首次切 tab 时标题顶到状态栏后再落回
- iOS 下载兼容策略：
  - B站智能首发兼容
  - 抖音当前默认消费官方完整档位；同一条新解析会话会默认选中左侧最高画质
  - iOS 预览已改用候选规划器：抖音优先无水印代理候选，B站优先 `proxy(merged mp4)`，并支持首帧超时 / buffering 自动切线
  - 抖音非音频下载首发在显式确认前仍使用 `allowWatermarkFallback=false`
  - 若后端返回 `DOUYIN_WATERMARK_FALLBACK_REQUIRED`，弹窗确认后自动续下
  - 原生下载阶段若晚到命中水印回退需求，端侧会做一次同页重分类与恢复
  - 相册不兼容（`PHPhotosErrorDomain 3301` / `IOS_PHOTOS_INCOMPATIBLE_CODEC`）友好提示 + 自动重试 `iosCompatible=true`
- Runtime 链路追踪：解析、预览、下载、历史重下流程接入 `runtimeTraceId`
- 通知角标与交互：
  - 通知 tab 角标由共享 store 驱动，单条已读 / 全部已读 / 清空后实时刷新
  - “全部已读 / 一键清空”按钮保持固定文案、固定宽度、图标位 loading，避免 iOS 交互抖动

### 2.4 Docker 与联调

- 默认模式：`backend + frontend`
- 可选模式：`--profile with-mysql` 增加 MySQL 容器
- `backend` 与 `frontend` 均配置健康检查
- `backend` 镜像当前已内置：
  - `ffmpeg` / `ffprobe`
  - `yt-dlp`（供其他平台使用，抖音主链路不再依赖）
  - Chromium
  - Python venv + `gmssl`
  - 本地抖音签名 helper：`/app/tools/douyin/abogus.py`
- `backend` 运行时会基于本地 helper 拉起常驻 Python worker 生成 `a_bogus`
- 仅 `backend/` 或 `frontend/` 改动时要求执行 `docker compose up -d --build`
- 仅 `mobile/` 或文档改动可跳过 Docker 重建

## 3. 当前运行配置与代码默认值

### 3.1 本机数据库当前生效模式（2026-03-22 核对）

- `douyin / WEB = QUALITY_FIRST`
- `douyin / MOBILE = QUALITY_FIRST`
- `bilibili / WEB = QUALITY_FIRST`
- `bilibili / MOBILE = COMPATIBILITY_FIRST`

### 3.2 代码默认值（数据库无配置时）

- 抖音：
  - `WEB = AVAILABILITY_FIRST`
  - `MOBILE = QUALITY_FIRST`
- B站：
  - `WEB = QUALITY_FIRST`
  - `MOBILE = COMPATIBILITY_FIRST`

### 3.3 抖音三种模式的后端语义

- `QUALITY_FIRST`
  - `allowWatermarkFallback=false`
  - `probeMode=strict`
- `SPEED_FIRST`
  - `allowWatermarkFallback=true`
  - `probeMode=fast`
- `AVAILABILITY_FIRST`
  - `allowWatermarkFallback=true`
  - `probeMode=smart`

说明：
- 三种模式当前只影响 `/api/download/get-url` 下载选流，不影响 `parse` 进入预览的速度。
- iOS 端额外有一层“带水印前显式确认”流程，所以即使后台允许回退，首次非音频下载仍会先尝试 `allowWatermarkFallback=false`。

## 4. 双端兼容口径（当前）

1. `POST /api/download/get-url` 双端必须显式传 `clientType`。
2. Runtime 追踪字段（`runtimeTraceId` / `x-runtime-trace-id` / 代理 query 参数）变更必须双端同步验证。
3. 当前端侧 Runtime 上报的 feature 范围为 `parse | preview | download`，新增或调整必须同步修改双端和后端校验。
4. 抖音当前解析口径是“官方详情 + 服务端会话”，前端和移动端都必须正确处理 `DOUYIN_SESSION_REQUIRED`。
5. 登录态、会员态、通知态、下载态改动必须提供双端联测证据。
6. 涉及分享拉起（Deep Link / 分享扩展）改动，必须验证去重与禁用态不回归。
7. App 保持“按用户所选画质单次下载”策略，不做隐式自动降档。
8. iOS `NativeTabs` 长列表页不要只依赖系统默认“tab 再次点击回顶”，`FlatList` 需要显式接入项目内回顶注册逻辑。

## 5. 当前未完成项与风险

1. 支付网关与会员开通闭环未接入。  
2. Web 与 Mobile E2E 自动化尚未补齐。  
3. iOS 相册不兼容场景下，若“首轮失败后兼容重试成功”，Runtime 仍可能只呈现最终成功，导致失败态低估。  
4. 抖音能力当前强依赖服务端会话与签名 helper，Cookie 失效或官方字段漂移会直接影响可用性。  
5. Web 与 Mobile 仍分别维护 API 类型与请求构造，尚未抽出 shared package，接口变更存在双端漂移风险。  
6. Web 与 Mobile 的账号能力覆盖尚未完全一致，Mobile 仍未承载 VIP 入口、密码修改、后台治理等管理能力。  
7. iOS 预览切线策略已明显改善首帧速度与 B站稳定性，但真实弱网环境下仍需继续观察 `PREVIEW_READY_FAILED` 与候选切换次数。

## 6. 本轮关键新增点（便于回溯）

1. 抖音解析主链路完成收敛，改为服务端会话 + `a_bogus/msToken` + 官方详情接口。  
2. 抖音 `parse` 正常路径直接返回完整画质集合，不再依赖匿名补档位。  
3. 抖音下载选流已改成官方候选优先、候选级缓存校验，`4k / 1440p / 1080p / 720p` 等档位区分稳定。  
4. Runtime 端侧 feature 口径补齐为 `parse | preview | download`，后台看板同步显示三段指标。  
5. iOS 端每次新解析会话会重新默认选中最高画质，同时保留同一会话内的手动改档。  
6. `a_bogus` 生成改为本地常驻 Python worker，消除了逐次起进程的额外损耗。
7. iOS 冷启动已切换为透明 splash + Logo 过渡动画，并修复 NativeTabs 首帧安全区抖动。
8. iOS 预览改为候选规划器 + 自动切线，抖音首发无水印代理优先，B站首发 `proxy(merged mp4)` 优先。
9. Web / Mobile 通知角标已改为共享状态实时刷新，通知操作按钮交互收敛为固定文案与稳定布局。
10. iOS 历史 / 通知长列表新增回顶悬浮按钮，并支持选中 tab 再次点击回到顶部。

## 7. 文档口径说明

- 当前事实文档：
  - `README.md`
  - 本快照
  - `docs/plans/2026-03-22-project-architecture-summary.md`
  - `docs/plans/2026-03-22-docker-deployment-guide.md`
  - `docs/plans/2026-03-16-dual-platform-development-checklist.md`
- 2026-03-20 及更早的 `development-status`、`docker-deployment-plan` 文档仅用于回溯，不可作为当前开发依据。
- 回归样例清单见 `docs/testdata/抖音测试样本.md`，其“最近维护日期”不等于功能状态日期。
