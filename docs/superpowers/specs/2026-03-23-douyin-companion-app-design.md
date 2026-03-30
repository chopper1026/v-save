# 抖音网页登录态管理 Companion App 方案设计

日期：2026-03-23

## 1. 背景

当前项目的抖音登录态由 `SUPER_ADMIN` 在网页登录态管理中统一维护，Web 与 Mobile 下载链路共用同一份服务端 Douyin Cookie。

现有两条思路都已被实测证明不适合作为长期上线方案：

1. 服务端浏览器方案
- 服务器或 Docker 容器内 Chromium 即使打开官方抖音登录页，在扫码确认后也无法稳定拿到 `sessionid` / `sessionid_ss`。
- 该问题在本地容器和云服务器环境都出现过，说明根因是运行环境被抖音风控识别，而不是前端轮询逻辑异常。

2. 纯服务端协议重放方案
- 已验证可生成二维码并进入轮询，但在二次轮询签名、`msToken` 续签、风控验证链路上仍不稳定。
- 当前无法给出“云服务器部署后也能稳定可用”的承诺。

与此同时，本机真实桌面 Chrome 登录抖音是可行的。因此，本设计选择把“登录动作”迁移到管理员本机真实 Chrome 中完成，而不是继续依赖服务器浏览器环境。

## 2. 目标与非目标

### 2.1 目标

1. 保持网页登录态管理作为唯一操作入口。
2. 管理员的日常动作尽量收敛为：
- 打开网页登录态管理
- 点击“扫码登录抖音”
- 使用手机抖音 App 扫码并确认
3. 最终保存的仍然是服务器上一份全局共享 Douyin 登录态。
4. 云服务器部署不依赖 GUI、Xvfb、Chromium 图形栈。
5. 首发仅支持 `macOS + Chrome`，但架构上预留 Windows 版本扩展能力。

### 2.2 非目标

1. 首发不支持普通用户各自绑定抖音账号。
2. 首发不支持 Safari、Firefox、Arc、Edge。
3. 首发不处理多管理员并发抢占同一抖音登录态的复杂协同。
4. 首发不把手动 Cookie 入口移除，只把它保留为高级兜底。

## 3. 方案总览

采用“网页发起 + 本机 Companion App 执行 + 服务器保存结果”的三段式架构。

### 3.1 核心思路

1. 网页端发起一次短时登录会话。
2. 本机 Companion App 通过 `localhost` 接受网页发起的登录请求。
3. Companion App 使用自己管理的专用 Chrome Profile 打开抖音官方登录页。
4. 管理员用手机抖音 App 完成扫码确认。
5. Companion App 通过 Chrome DevTools Protocol 从该专用 Profile 中读取 `.douyin.com` 登录态 Cookie。
6. Companion App 通过 HTTPS 将 Cookie 上传至项目后端。
7. 后端复用现有 Douyin Cookie 保存逻辑落库。
8. 网页端轮询服务器会话状态并展示“登录成功，Cookie 已保存”。

### 3.2 为什么不用浏览器扩展

浏览器扩展可以实现类似体验，但长期分发和稳定性会受 Chrome 分发策略、权限审核和潜在下架风险影响。当前项目只需要让少数管理员维护一份全局登录态，Companion App 在分发、权限和运行边界上更可控，也更适合作为“云服务器可用”的正式方案。

## 4. 用户体验

### 4.1 首发主流程

1. 管理员进入网页登录态管理。
2. 点击“扫码登录抖音”。
3. 网页检测本机 Companion App 是否在线。
4. 若未安装或未启动，页面给出明确提示：
- 未安装：引导下载 macOS 安装包
- 未启动：引导打开 Companion App
5. 若在线，网页向服务器申请短时登录会话，并把会话参数发送给本机 Companion App。
6. Companion App 拉起专用 Chrome 窗口并打开抖音官方登录页。
7. 管理员使用手机抖音 App 扫码并确认。
8. Companion App 检测到登录成功后自动上传 Cookie。
9. 网页轮询服务器状态，显示“登录成功，Cookie 已保存”。

### 4.2 失败态

1. 本机助手未安装
- 页面显示“未检测到本机登录助手，请先安装”
- 提供下载入口和帮助文档链接

2. 本机助手未启动
- 页面显示“已安装但未启动，请先打开 V-SAVE Companion”

3. Chrome 未安装
- Companion App 本地提示“未检测到 Google Chrome”
- 网页显示“本机登录失败，请查看登录助手提示”

4. 抖音触发额外风险验证
- Companion App 本地显示当前状态
- 网页仅显示“登录未完成，请根据浏览器提示完成抖音验证后重试”
- 首发不在网页内继续承接二次验证 UI

5. 上传失败
- Companion App 保留最近一次错误摘要
- 网页通过服务器状态展示“登录结果同步失败，请重试”

## 5. 系统架构

### 5.1 网页端

保留现有 [frontend/src/hooks/useDouyinAuthManager.ts](../../../frontend/src/hooks/useDouyinAuthManager.ts) 的状态查询、清空登录态、手动保存 Cookie 逻辑，但将当前二维码轮询主流程替换为“桥接登录会话状态机”。

网页端新增职责：

1. 检测本机 Companion App 连通性。
2. 调用后端创建短时桥接登录会话。
3. 将会话参数发给本机 Companion App。
4. 轮询后端桥接会话状态。
5. 根据状态渲染文案：
- 等待本机助手
- 已拉起 Chrome，等待扫码
- 已扫码，等待同步
- 登录成功
- 登录失败

### 5.2 后端

后端不再负责“抖音二维码生成、协议轮询、短信验证”这一整段复杂链路，而是退回到更稳定的职责边界：

1. 创建桥接登录会话
2. 校验一次性上传令牌
3. 保存 Companion App 回传的 Cookie
4. 记录操作审计日志
5. 对网页登录态管理暴露统一的状态查询接口

### 5.3 Companion App

首发 Companion App 采用 macOS 菜单栏应用形态，内部拆为三个模块：

1. `Local Bridge Server`
- 监听 `127.0.0.1:<固定端口>`
- 提供 `health`、`start-login`、`current-session` 等本地接口

2. `Chrome Session Orchestrator`
- 查找本机 Chrome
- 使用专用 Profile 启动 Chrome
- 打开抖音官方登录页
- 通过 CDP 轮询 Cookie 是否出现

3. `Server Sync Client`
- 携带服务器下发的短时令牌，通过 HTTPS 上传 Cookie
- 上传成功后更新本地会话状态

## 6. 后端接口设计

保留现有接口：

- `GET /api/douyin/auth/status`
- `POST /api/douyin/auth/session`
- `DELETE /api/douyin/auth/session`

新增桥接接口：

### 6.1 `POST /api/douyin/auth/bridge/start`

用途：
- 创建一次短时桥接登录会话

返回：

```json
{
  "success": true,
  "data": {
    "authSessionId": "uuid",
    "expiresAt": "2026-03-23T10:00:00.000Z",
    "uploadToken": "opaque-short-lived-token",
    "loginUrl": "https://www.douyin.com/",
    "status": "waiting_helper"
  }
}
```

要求：
- 仅 `SUPER_ADMIN` 可调用
- 单次只保留一个活跃桥接会话
- 新会话创建时使旧会话失效

### 6.2 `GET /api/douyin/auth/bridge/status`

请求参数：
- `authSessionId`

返回状态枚举：
- `waiting_helper`
- `browser_opened`
- `waiting_scan`
- `scanned`
- `uploading`
- `confirmed`
- `failed`
- `expired`

附带字段：
- `message`
- `reasonCode`
- `updatedAt`

### 6.3 `POST /api/douyin/auth/bridge/complete`

调用方：
- Companion App

请求体：

```json
{
  "authSessionId": "uuid",
  "uploadToken": "opaque-short-lived-token",
  "cookieHeader": "sessionid=...; sessionid_ss=...; ..."
}
```

行为：
- 校验会话是否有效
- 校验上传令牌是否匹配且未过期
- 校验请求对应管理员身份
- 复用现有 `saveCookie()` 保存登录态
- 将桥接会话状态置为 `confirmed`

## 7. 数据模型

新增一张桥接登录会话表，例如 `douyin_bridge_auth_sessions`：

- `id`
- `authSessionId`
- `adminUserId`
- `status`
- `uploadTokenHash`
- `loginUrl`
- `lastError`
- `clientName`
- `clientVersion`
- `startedAt`
- `expiresAt`
- `confirmedAt`
- `createdAt`
- `updatedAt`

说明：
- 只保存上传令牌摘要，不保存明文
- 不保存完整 Douyin Cookie
- Cookie 最终仍只进入现有 Douyin Session 表

## 8. Companion App 设计

### 8.1 运行方式

首发做成 macOS 菜单栏应用，启动后常驻。

本地服务建议仅绑定：

- `127.0.0.1`

默认端口可固定，例如：

- `127.0.0.1:37219`

### 8.2 Chrome 接管方式

Companion App 首发仅支持 Google Chrome。

建议使用专用 Profile 目录：

- `~/Library/Application Support/V-SAVE Companion/chrome-profile`

启动参数：

- `--user-data-dir=<专用 profile>`
- `--remote-debugging-port=<本地随机端口>`
- 打开抖音官方登录页

为什么使用专用 Profile：

1. 避免污染管理员日常使用的默认 Chrome Profile
2. 避免与已有 Chrome 实例的锁文件和扩展环境冲突
3. 更易于控制 Cookie 生命周期与调试行为

### 8.3 Cookie 获取

Companion App 不直接解密 Chrome 的 Cookie 数据库，而是通过 CDP 查询当前受控浏览器上下文中的 Cookie。

成功判定条件：

至少拿到以下关键 Cookie 之一：

- `sessionid`
- `sessionid_ss`

上传前可补充同域辅助 Cookie，但不得丢失关键登录态字段。

## 9. 安全模型

1. Companion App 只监听 `127.0.0.1`
2. 本地桥接接口只接受来自允许来源的请求
3. 上传令牌必须短时有效，建议 5 分钟
4. Companion App 不长期保存 Douyin Cookie
5. 上传成功后仅保留短时内存会话摘要
6. 服务器必须通过 HTTPS 接收 Cookie
7. Companion App 只允许上传到预先配置的可信后台域名
8. 审计日志中不得记录明文 Cookie

## 10. 发布与部署

### 10.1 云服务器

云服务器继续保持当前轻量部署结构：

- `frontend + backend + mysql`

不再需要：

- Xvfb
- 图形浏览器运行时
- 服务器本地 Chrome

### 10.2 macOS Companion App

首发交付物：

- `.app`
- `.dmg`

正式分发要求：

1. 使用 Apple `Developer ID` 签名
2. 完成 notarization
3. 提供最小安装说明

### 10.3 Windows 预留

后续 Windows 版本复用同一套抽象：

- `Local Bridge Server`
- `Chrome Session Orchestrator`
- `Server Sync Client`

保持不变：

- 后端桥接接口
- 网页状态机
- 审计与登录态保存逻辑

## 11. 实施分期

### Phase 1：方案落地

1. 补充设计文档
2. 明确后端桥接接口与实体模型
3. 明确前端网页登录态状态机
4. 选定 macOS Companion App 技术栈

### Phase 2：后端与网页改造

1. 新增桥接会话实体与接口
2. 接入现有 Douyin Cookie 保存逻辑
3. 替换网页抖音扫码登录主入口
4. 保留手动 Cookie 兜底入口

### Phase 3：Companion App 首发版

1. 本地 HTTP 服务
2. Chrome 启动与 CDP 接管
3. 登录成功后 Cookie 上传
4. 菜单栏状态和错误提示

### Phase 4：联调与发布

1. 本地联调
2. Docker 联调
3. 云服务器联调
4. macOS 安装包签名与 notarization

## 12. 验证方案

### 12.1 本地联调

1. 网页能检测到本机 Companion App
2. 点击“扫码登录抖音”后，Chrome 专用窗口被正常拉起
3. 扫码确认后，后端 `GET /api/douyin/auth/status` 返回 `hasCookie: true`
4. 后台页面显示登录成功
5. 使用需登录态的抖音链接完成 `parse -> preview -> download`

### 12.2 Docker 联调

1. `frontend + backend` 容器正常运行
2. Companion App 能连接 Docker 暴露的本地开发地址
3. 完整走通扫码保存流程

### 12.3 云服务器验收

1. Companion App 能连接线上后台域名
2. 完整走通“网页登录发起 -> 本机 Chrome 扫码 -> 服务端保存”
3. Web 和 Mobile 均能复用该服务端登录态

## 13. 风险与取舍

### 13.1 风险

1. 需要额外维护一个 macOS 本地应用
2. 首发需要处理 Apple 签名与 notarization
3. 抖音仍可能对部分本机浏览器会话触发额外验证
4. Windows 版本后续仍需要单独适配

### 13.2 取舍

相较于浏览器扩展或服务器浏览器方案，Companion App 的首发开发成本更高，但换来的是：

1. 更稳定的 Douyin 登录成功率
2. 更弱的平台策略依赖
3. 更适合云服务器部署的架构边界
4. 更可控的安全和调试能力

## 14. 决策结论

抖音网页登录态管理的正式替代方案选定为：

`macOS Companion App + Chrome 专用 Profile + localhost 桥接 + 服务器全局登录态保存`

该方案将作为后续实现和发布的基线方案。服务器侧不再继续投入“抖音扫码登录浏览器环境”方向的主线研发，仅保留手动 Cookie 兜底能力用于应急。
