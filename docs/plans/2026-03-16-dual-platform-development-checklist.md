# V-SAVE 双端开发检查清单（Web + App）

**Last Updated:** 2026-03-22
**适用仓库:** `<repo-root>`

## 1. 适用场景

用于所有会影响以下任一范围的开发任务：

- Web 前台或后台页面 / 交互
- Mobile App 页面 / 交互 / 分享拉起
- Backend API 契约、鉴权、下载链路
- 用户状态（登录、会员、通知、下载历史）相关能力
- 运行看板、下载模式、登录态治理等后台能力

## 2. 双端基线（开发前先确认）

- Web 与 Mobile 共用同一套后端 API，接口变更必须考虑双端兼容。
- 下载默认策略由后台模式中心按 `clientType` 接管，Web / Mobile 必须显式上报端侧来源。
- App 当前为 iOS 优先 v1，分享入口含 Deep Link 与分享扩展。
- Docker 联调口径：Web 默认 `http://localhost:4871`，Mobile 直连 `http://<LAN-IP>:3001/api`。
- Docker 时区口径：容器统一 `TZ=Asia/Shanghai`（北京时间）。
- 首版不包含后台持续下载 / 断点续传，不要误加此类验收口径。
- 系统推送（APNs / FCM）未接入，不要把推送当成默认通知通道。
- 支付闭环未接入，VIP 仍为站内流程占位。
- Web 与 iOS logo 独立维护，不允许混用素材。

## 3. 开发前检查（Plan）

- [ ] 需求是否明确写出 Web 与 App 各自用户路径
- [ ] 是否确认改动属于：仅单端 / 双端 + 后端联动
- [ ] 是否列出不在本次范围的能力（避免隐式扩 scope）
- [ ] 是否列出回滚策略（至少包含 API 与入口层面）
- [ ] 若涉及第三方域名、下载器、二维码、字体或可执行文件路径，是否同步规划文档更新

## 4. 影响面盘点（Impact Matrix）

每次任务开始前，至少完成一次勾选：

- [ ] Web 页面路由与入口（如 `/`、`/user`、`/admin`）
- [ ] App 页面路由与入口（tabs、`/share`、`/preview`）
- [ ] 分享拉起链路（Deep Link / 分享扩展）是否受影响
- [ ] Backend 控制器 / DTO / 返回结构是否变化
- [ ] 数据模型或字段含义是否变化（如 membership / status）
- [ ] 文档与示例是否需要同步（README、plans、接口说明）

## 5. 实现中检查（Build）

### 5.1 API 契约一致性

- [ ] 请求参数在双端含义一致（字段名、必填规则、默认值）
- [ ] `POST /download/get-url` 双端均显式上报 `clientType`，且后台模式配置切换后双端行为一致
- [ ] 抖音下载参数兼容：`clientType` 必传，`allowWatermarkFallback` 仅用于显式一次性覆盖
- [ ] 抖音解析口径一致：双端都按“服务端会话 + 官方 detail 接口”消费结果，不以匿名 fallback 为验收假设
- [ ] 响应结构保持向后兼容（新增字段优先，避免破坏性改名）
- [ ] 错误码 / 错误文案可被双端正确映射与展示
- [ ] `DOUYIN_SESSION_REQUIRED`、`DOUYIN_WATERMARK_FALLBACK_REQUIRED` 等抖音关键业务错误可被双端正确映射与恢复
- [ ] 鉴权接口行为一致（401、403、禁用账号）
- [ ] Runtime 追踪字段兼容：`runtimeTraceId` / `x-runtime-trace-id` 在双端行为一致
- [ ] 当前端侧 Runtime 上报 `feature` 范围为 `parse | preview | download`，变更时双端和后端校验口径同步更新

### 5.2 业务状态一致性

- [ ] 登录态：登录、过期失效、退出在双端行为一致
- [ ] 会员态：FREE / VIP 及权益边界在双端一致
- [ ] 下载态：队列状态（queued / processing / completed / failed）一致
- [ ] 通知态：未读数、单条已读、全部已读、清空行为一致
- [ ] 通知受众规则一致：内部登录态通知仅发给 `SUPER_ADMIN`
- [ ] 登录态失效通知去重一致：存在未读同平台同类通知时不重复发

### 5.3 端侧特有能力保护

- [ ] Web：后台权限（`SUPER_ADMIN`）入口与接口守卫一致
- [ ] Web：`/admin?tab=download-policy` 入口与权限守卫一致（普通用户不可见）
- [ ] Web：后台默认入口与导航顺序符合当前约定（默认进入 `运行看板`）
- [ ] Web：通知“去处理”在登录态通知场景路由到 `/admin?tab=auth`
- [ ] Web：危险操作二次确认统一使用复用确认弹层（不使用原生 `window.confirm`）
- [ ] App：分享拉起去重逻辑不被破坏（避免重复解析）
- [ ] App：相册权限 / 保存失败路径有明确提示与兜底
- [ ] App：保持“按用户所选画质单次下载”，不隐式自动降档
- [ ] App：每次新解析会话默认选中当前最高画质，但同一会话内的手动改档可保留

### 5.4 iOS 下载策略专项

- [ ] B站“智能首发”逻辑未回归（`codecid` 判断 + 首发 `iosCompatible`）
- [ ] 抖音策略未回归：Web / Mobile 通过 `clientType` 走后台模式中心，端侧仅保留一次性覆盖
- [ ] 抖音当前解析仍直接返回完整质量集合，未回退到“先 720p、后补档”的旧假设
- [ ] 非 B站平台默认首发仍为普通链路
- [ ] iOS 相册失败（含 `PHPhotosErrorDomain 3301` / `IOS_PHOTOS_INCOMPATIBLE_CODEC`）后会自动触发一次 `iosCompatible=true` 重试，并展示友好 Toast
- [ ] `merge?iosCompatible=1` 链路在 Web 与 App 都可正常下载
- [ ] 抖音长视频下载链路验证通过（代理连接超时 / 流空闲超时不误伤正常下载）

## 6. 提测前检查（Verify）

### 6.1 最小回归（Web）

- [ ] 登录 / 注册 / 退出
- [ ] 首页解析 -> 预览 -> 下载
- [ ] 历史筛选（平台 / 日期）与清空
- [ ] 历史分页、删除、重新下载
- [ ] 用户中心资料更新、改密、绑定手机号
- [ ] 通知列表、单条已读、全部已读、一键清空
- [ ] 管理员入口可见性（普通用户不可见）
- [ ] 管理后台运行看板默认可达，默认时间窗为“今日”
- [ ] 平台全链路接口耗时卡片默认展开，可折叠
- [ ] 链路详情可见端侧耗时 / 接口耗时 / 链路跨度，阶段顺序正确
- [ ] 管理后台下载模式管理：折叠交互、模式切换保存、刷新后配置回填正常
- [ ] 管理后台登录态管理与审计查询正常
- [ ] 管理后台用户管理筛选与关键操作正常

### 6.2 最小回归（App）

- [ ] 冷启动自动登录恢复
- [ ] 首页粘贴链接解析
- [ ] 分享扩展 / Deep Link 拉起并触发解析
- [ ] 自动解析期间输入控件禁用态
- [ ] 预览下载成功路径
- [ ] iOS 相册失败提示与重试路径
- [ ] 历史筛选（平台 / 日期）
- [ ] 历史一键清空
- [ ] 历史长按多选 / 全选 / 删除选中
- [ ] 通知全部已读与一键清空

### 6.3 后端与脚本

- [ ] 改动触达模块单测通过
- [ ] 下载主链路接口可用（parse / get-url / create-task / tasks / file / merge）
- [ ] 抖音官方链路回归可用（含 `DOUYIN_SESSION_REQUIRED`、4K 档位、官方候选直选）
- [ ] 抖音下载边界回归可用（含 `DOUYIN_WATERMARK_FALLBACK_REQUIRED` 场景）
- [ ] 下载模式管理接口回归可用（schema / configs / update）
- [ ] 下载模式配置变更写入审计日志，模块为 `DOWNLOAD_POLICY`
- [ ] 通知接口回归可用（`read-all` / `clear` / 受众过滤）
- [ ] Runtime 链路查询接口回归可用（dashboard / chains / detail）
- [ ] 相关回归脚本已运行并记录结论（如 iOS B站回归）

## 7. 发布与文档收口（Release）

- [ ] `README.md` 能力描述与当前实现一致
- [ ] `docs/plans/2026-03-22-development-status.md` 已更新
- [ ] `docs/plans/2026-03-22-project-architecture-summary.md` 已更新
- [ ] `docs/plans/2026-03-22-docker-deployment-guide.md` 已更新
- [ ] 明确记录“已完成 / 未完成 / 风险 / 下一步”
- [ ] PR / 提交说明包含双端验证证据（Web + App + Backend）
- [ ] 若改动触达 Web / Backend，执行 `docker compose up -d --build` 并记录结果
- [ ] 若仅 iOS 或文档改动，可跳过 Docker 重建并在说明中注明
