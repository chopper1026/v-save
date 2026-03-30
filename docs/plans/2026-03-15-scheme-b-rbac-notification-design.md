# V-SAVE 方案B落地回填（RBAC + 后台管理 + 通知中心）

> Baseline design archived on 2026-03-18. Latest implementation status: `docs/plans/2026-03-22-development-status.md`.

**Date:** 2026-03-15  
**Scope:** 方案B已落地部分与后续扩展位

## 1. 目标回顾

方案B目标为：

1. 建立可执行 RBAC（超级管理员 vs 普通用户）
2. 完成后台用户治理（角色、会员、状态）
3. 登录态管理仅管理员可见
4. 建立通知中心并接入关键事件
5. 形成可追溯操作审计

当前以上目标已完成核心落地。

## 2. 最终信息架构（已实现）

### 2.1 后台路由与入口

1. 统一后台页：`/admin?tab=users|audit|auth|download-policy`
2. 顶栏入口：仅 `SUPER_ADMIN` 可见“后台管理”
3. 兼容跳转：`/admin/users` -> `/admin?tab=users`

### 2.2 后台菜单（最终版）

1. `users` 用户管理（含角色分配）
2. `audit` 操作审计
3. `auth` 登录态管理（B站/抖音）
4. `download-policy` 下载模式管理（抖音/B站分端配置，其他平台只读）

说明：独立“角色管理”页已取消，角色操作已并入用户管理。

## 3. 权限模型（已实现）

### 3.1 角色定义

1. `SUPER_ADMIN`：可访问全部后台能力
2. `USER`：不可访问后台能力
3. `游客`：未登录，仅可访问公开页面

### 3.2 会员维度（业务属性）

1. `membershipLevel: FREE | VIP`
2. 会员不是管理角色，不参与后台访问控制

### 3.3 账号状态

1. `ACTIVE`：允许登录与下载
2. `DISABLED`：禁止登录与下载

### 3.4 权限守卫

1. 后台与登录态接口统一 `JwtAuthGuard + RolesGuard`
2. 强制 `@Roles('SUPER_ADMIN')`
3. 登录时校验禁用态，禁用账号直接拒绝

## 4. 数据模型（已实现）

### 4.1 `users` 字段

1. `role: SUPER_ADMIN | USER`
2. `membershipLevel: FREE | VIP`
3. `accountStatus: ACTIVE | DISABLED`
4. `vipExpireDate` 保留用于会员有效期

说明：`isVIP` 字段已下线，历史数据已迁移到 `membershipLevel`。

### 4.2 审计表 `user_admin_audit_logs`

1. 记录操作人、目标、动作、变更前后状态、备注、时间
2. 扩展字段：
- `module: USER | ROLE | AUTH | DOWNLOAD_POLICY`
- `platform: BILIBILI | DOUYIN | NONE`
- `targetType: USER | AUTH_SESSION | SYSTEM`

## 5. 后端接口（已实现）

### 5.1 用户治理

1. `GET /admin/users`
2. `PATCH /admin/users/:id/role`
3. `PATCH /admin/users/:id/membership`
4. `PATCH /admin/users/:id/status`

### 5.2 审计查询

1. `GET /admin/audit`（主接口）
2. `GET /admin/users/audit`（兼容保留）

### 5.3 登录态管理

1. B站：状态、扫码、轮询、刷新、清空
2. 抖音：状态、扫码、轮询、手动 Cookie 保存、清空
3. 健康检查：`GET /auth/health`

### 5.4 下载模式管理（2026-03-19 增量）

1. `GET /api/admin/download-modes/schema`
2. `GET /api/admin/download-modes/configs`
3. `PUT /api/admin/download-modes/configs/:platform/:clientType`
4. 策略默认值由后台统一治理，`get-url` 请求需显式上报 `clientType`

## 6. 关键约束（已实现）

1. 管理员不可将自己降级为普通用户
2. 系统至少保留一个超级管理员
3. 管理员不可禁用当前登录账号
4. 系统至少保留一个启用状态超级管理员

## 7. 审计与通知（已实现）

### 7.1 审计覆盖

1. 用户动作：角色调整、会员调整、状态调整
2. 登录态动作：
- B站二维码生成/扫码确认/Cookie刷新/清空
- 抖音二维码生成/扫码确认/Cookie保存/清空
3. 下载模式动作：
- 平台 + 端侧（Web/Mobile）模式配置更新
4. 轮询 `pending` 不落审计，避免日志噪声

### 7.2 通知覆盖

1. Cookie 风险、失效、恢复
2. 会员开通、续费、即将到期、已过期
3. 密码修改、手机号修改
4. 管理动作影响用户权益时通知到用户
5. 2026-03-18 增量：`AUTH_RECOVERED` / `COOKIE_RISK` / `COOKIE_EXPIRED` 仅面向 `SUPER_ADMIN`
6. 2026-03-18 增量：同平台登录态失效类通知在“存在未读同类通知”时不重复发送

### 7.3 通知字段规范

1. `type`
2. `source: auth | vip | account | security | system`
3. `level: info | success | warn | error`
4. `actionUrl`
5. `dedupKey`（防刷屏去重）

## 8. 前端交互实现结果

### 8.1 用户管理

1. 用户/邮箱字段超长省略，hover 显示完整内容
2. 会员到期时间单行展示优化
3. 操作按钮使用完整中文，降低误操作
4. 默认排序：角色优先 + 注册时间升序
5. 分页默认每页 10 条

### 8.2 操作审计

1. 新增“操作详情”可读文案（展示具体变更）
2. 筛选区与分页布局收敛，默认每页 10 条

### 8.3 登录态管理

1. 已从个人中心迁入后台管理
2. 仅超级管理员可见

## 9. 与原方案的差异说明

1. 原方案中的“独立角色管理菜单”已合并进用户管理
2. 原方案中的 `isVIP` 兼容字段设计已取消
3. 审计入口主路径改为 `/admin/audit`，保留旧路径兼容

## 10. 后续增强建议

1. 用户管理批量操作（批量启停/会员批量调整）
2. 审计导出与高级检索（按动作类型、时间范围）
3. 通知偏好配置（类型级开关、渠道扩展）
4. 登录态健康检查指标面板（趋势图 + 异常追踪）
