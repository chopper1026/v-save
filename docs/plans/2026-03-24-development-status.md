# Development Status - 2026-03-24

## 当前结论

- Web、Mobile、Backend 主链路保持可用，双端仍共用同一份服务端抖音登录态。
- 抖音网页登录态管理主方案已经明确收敛为 `Companion App + 本机 Chrome + backend bridge session`。
- 旧的抖音服务端二维码浏览器、Xvfb、有头 Chromium、协议级二维码复刻代码已从主线移除，不再作为当前实现维护。
- Companion 主链路的代码、测试、构建和本地 Docker 联调已完成收口，但真实抖音账号的端到端实机扫码回归仍未在文档上标记为 fully verified。
- 会员、支付、订单体系已从主线移除，不再作为当前实现维护。
- Web 与 Mobile 账户页已收口到资料、通知、下载历史与账号治理能力。
- 下载权限已统一为登录用户可直接使用，不再区分免费/VIP 权益。

## 本轮已完成

### Backend

- 保留并验证：
  - `POST /api/douyin/auth/bridge/start`
  - `GET /api/douyin/auth/bridge/status`
  - `POST /api/douyin/auth/bridge/complete`
- `bridge/start -> bridge/status -> bridge/complete` 继续复用服务端共享 Douyin Cookie 存储，不引入每用户独立登录态。
- 已删除旧的抖音服务端扫码入口：
  - `/api/douyin/auth/qrcode`
  - `/api/douyin/auth/qrcode/poll`
- 已移除旧的服务端抖音扫码实现残留：
  - `douyin-passport.client`
  - `douyin-qr-auth-flow.service`
  - `DouyinQrAuthFlow` 实体
- Kuaishou parser 不再复用 `DOUYIN_QR_CHROME_PATH` 这类旧环境变量。

### Billing Cleanup（新增）

- 后端 `payments` 模块、订单接口、退款/对账逻辑与 Stripe 依赖已从主线移除。
- `users` 表中的会员字段与 `download_history` 中的额度统计字段已清理。
- Web `/vip`、用户中心订单区与后台订单管理入口已删除或重定向到存量页面。

### Frontend

- 抖音登录态面板已固定为 bridge-first UX：
  - 主入口为“扫码登录抖音”
  - 手动 Cookie 收进“高级兜底”折叠区
- 后台页与用户中心复用同一套抖音 bridge 状态机与面板组件。
- 已修正 split frontend/backend 部署下的 helper 回传 origin，当前以 `VITE_API_BASE_URL` 解析出的 API origin 为准，不再错误使用 `window.location.origin`。
- bridge 成功后会主动刷新 Douyin 登录态快照，不再只刷新 auth-health。
- 手动保存/清空 Cookie 前会重置旧 bridge 状态，避免陈旧 bridge 错误覆盖手动操作反馈。

### Companion App

- companion 主线已切到原生 `VSaveCompanion` 工程，旧的 Electron / TypeScript helper 工作区已从仓库移除。
- 已实现本地 helper：
  - `GET /health`
  - `GET /login/current`
  - `POST /login/start`
- 已实现：
  - 专用 Chrome profile 启动
  - 基于 CDP 的 Douyin 登录 Cookie 监听
  - 回传 `authSessionId + uploadToken + cookieHeader` 到 backend
- 已修正：
  - Chrome DevTools 连接抢跑
  - split frontend/backend origin 校验
  - 浏览器 CORS 预检 `OPTIONS` 放行
- 当前运行交互为：
  - 仅菜单栏 helper
  - 左键与右键都打开同一个中文状态面板
  - 状态面板内统一承载 `开机自启`、`重启助手`、`退出助手`

### 文档与仓库清理

- 已清理旧的抖音服务端扫码/Xvfb/协议复刻相关代码与调试产物。
- 已删除无用本地分支与挂载的旧 worktree，当前本地仅保留 `main`。
- 当前事实文档开始切换到 2026-03-24 快照，旧的 2026-03-22 / 2026-03-23 文档降级为历史快照。

## 当前风险

- Companion App 的真实抖音账号扫码链路仍需继续做一次完整实机回归，重点验证：
  - 本机 Chrome 拉起稳定性
  - `sessionid/sessionid_ss` 捕获稳定性
  - backend `bridge/complete` 落库稳定性
- 默认安全策略下，Companion App 只信任 `https` 源站和本地 `localhost/127.0.0.1`。若管理员后台仍是公网 `http://IP`，需要显式配置 `V_SAVE_ALLOWED_BACKEND_ORIGINS`。
- Windows helper 尚未开始，当前只支持 `macOS + Chrome`。
- Web 与 Mobile 仍未抽出 shared API 类型层，接口变更仍存在双端漂移风险。

## 本地验证结果

- `npm --prefix backend test -- douyin-auth.controller.spec.ts douyin-auth.service.spec.ts douyin-bridge-auth.service.spec.ts --runInBand`
  - PASS
- `npm --prefix backend run build`
  - PASS
- `npm --prefix frontend test`
  - PASS
- `npm --prefix frontend run build`
  - PASS
- `npm --prefix companion test`
  - PASS
- `npm --prefix companion run build`
  - PASS
- `docker compose up -d --build backend frontend`
  - PASS
- `docker compose ps`
  - backend / frontend 均为 `healthy`

## 下一步

1. 用真实抖音账号走一遍 `网页登录态管理 -> Companion App -> Chrome -> 保存共享 Cookie` 的完整回归。
2. 在回归通过前，继续保留手动 Cookie 作为抖音登录态兜底入口。
3. 后续如果要启动 Windows 版本，复用当前 bridge session 与前端状态机，不再回到服务端扫码方向。
