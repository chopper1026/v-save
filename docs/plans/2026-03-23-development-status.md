# Development Status - 2026-03-23

> Superseded on 2026-03-24. Latest snapshot: `docs/plans/2026-03-24-development-status.md`.

## 当前结论

- Web、Mobile、Backend 主链路保持可用，双端仍共用同一份服务端抖音登录态。
- 抖音网页登录态管理已经从“服务端二维码浏览器”明确切换到“Companion App + 本机 Chrome”主方案。
- 本轮已完成 backend bridge session、frontend bridge-first UI、companion 本地 bridge/Chrome 编排/服务端回传的基础代码。
- 当前仍缺最后一段真实账号的本机扫码回归，尚不能把 companion 路径标记为 fully verified。

## 本轮已完成

### Backend

- 已有 `/api/douyin/auth/bridge/start`
- 已有 `/api/douyin/auth/bridge/status`
- 已有 `/api/douyin/auth/bridge/complete`
- bridge session 已入库，上传令牌按 hash 存储
- bridge completion 复用了现有 `saveCookie()` 路径，仍然只维护一份共享 Douyin Cookie

### Frontend

- 抖音登录态面板已切到 bridge-first UX
- 后台页与用户中心共用同一套抖音 bridge 状态机
- 手动 Cookie 入口仍保留，但已收进高级兜底折叠区
- 本地 helper 检测固定走 `http://127.0.0.1:37219/health`

### Companion App

- 已有 macOS Companion helper 基础实现；该阶段文档最初以 Electron-first 方案记录，当前主线已收敛为原生 `VSaveCompanion`
- 已实现本地 HTTP bridge：
  - `GET /health`
  - `GET /login/current`
  - `POST /login/start`
- 已实现专用 Chrome profile 启动
- 已实现基于 CDP 的 Douyin 登录 Cookie 监听
- 已实现把 `authSessionId + uploadToken + cookieHeader` 回传服务端

## 当前风险

- Companion App 的实际扫码登录链路还缺真实抖音账号回归，尤其是：
  - 本机 Chrome 拉起是否稳定
  - `sessionid/sessionid_ss` 是否能稳定捕获
  - backend bridge completion 是否能稳定落库
- 默认安全策略下，Companion App 只信任 `https` 源站和本地 `localhost/127.0.0.1`。如果管理员后台仍是公网 `http://IP`，需要显式配置 `V_SAVE_ALLOWED_BACKEND_ORIGINS`。
- Windows helper 尚未开始，当前只支持 `macOS + Chrome`.

## 本地验证结果

- `npm --prefix backend test -- douyin-auth.service.spec.ts douyin-auth.controller.spec.ts douyin-bridge-auth.service.spec.ts jwt-auth.guard.spec.ts roles.guard.spec.ts complete-douyin-bridge-auth.dto.spec.ts --runInBand`
  - PASS
- `npm --prefix backend run build`
  - PASS
- `npm --prefix frontend test -- useDouyinBridgeAuth.test.ts DouyinAuthPanel.test.tsx auth-management-shared.test.ts`
  - PASS
- `npm --prefix frontend run build`
  - PASS
- `npm --prefix companion test`
  - PASS
- `npm --prefix companion run build`
  - PASS
- `npm --prefix companion run dev` + `curl http://127.0.0.1:37219/health`
  - PASS（helper 已能正常监听 `37219` 并返回健康状态）
- `docker compose build backend frontend`
  - PASS
- `docker compose up -d backend frontend`
  - PASS

## 下一步

1. 启动 `companion/` 本地 helper，走一遍真实抖音扫码登录。
2. 如果 helper 与前端状态联动存在断点，优先补 `/login/current` 到前端 hook 的联调。
3. 输出管理员 runbook，并收口 macOS 安装/启动/allowlist 配置说明。
