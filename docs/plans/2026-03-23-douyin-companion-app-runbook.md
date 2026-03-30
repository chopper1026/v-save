# Douyin Companion App Runbook

**Last Updated:** 2026-03-24

## 适用范围

- 管理员网页登录态管理中的抖音扫码登录
- 首发平台：`macOS`
- 首发浏览器：`Google Chrome`

## 目标

管理员仍然只需要在网页里点“扫码登录抖音”，然后用手机抖音 App 扫码确认。真正的登录动作发生在管理员本机 Chrome，最终 Cookie 回传服务端并保存为全站共享 Douyin 登录态。

## 组件关系

- `frontend`
  - 发起 `/api/douyin/auth/bridge/start`
  - 探测本机 `http://127.0.0.1:37219/health`
  - 请求本机 `POST /login/start`
- `companion`
  - 启动本地 bridge server
  - 拉起本机 Chrome 专用 profile
  - 监听 Douyin 登录 Cookie
  - 回传 `/api/douyin/auth/bridge/complete`
- `backend`
  - 创建 bridge session
  - 校验 `uploadToken`
  - 保存共享 Douyin Cookie

## 管理员前置条件

- macOS 已安装 Google Chrome
- 管理员账号为 `SUPER_ADMIN`
- 后端与前端已启动
- Companion App 已启动
- 如果前后端分域部署，前端必须正确配置 `VITE_API_BASE_URL`

## 源码运行方式

```bash
cd companion
npm install
npm run dev
```

打包安装可执行：

```bash
cd companion
npm install
npm run dist:mac
```

## 本地服务端口

- 本机 helper 固定监听：`http://127.0.0.1:37219`
- 健康检查：`GET /health`
- 当前会话：`GET /login/current`
- 发起本地登录：`POST /login/start`

## 标准使用流程

1. 启动 backend / frontend
2. 启动 `V-SAVE Companion`
3. 打开网页登录态管理页
4. 点击“扫码登录抖音”
5. 本机 Chrome 会被拉起到抖音官方登录页
6. 使用手机抖音 App 扫码并确认
7. companion 捕获 `sessionid/sessionid_ss`
8. companion 调用 `/api/douyin/auth/bridge/complete`
9. 后端保存共享 Douyin Cookie
10. 页面刷新抖音登录态为已配置

## Companion 交互

- 启动后隐藏 Dock，只保留菜单栏图标
- 左键或右键菜单栏图标：都打开同一个中文状态面板
- 状态面板内提供 `开机自启`、`重启助手`、`退出助手`
- 日志文件：`~/Library/Logs/V-SAVE Companion/bridge.log`

## 非 HTTPS 后台的额外配置

默认情况下，Companion App 只信任：

- `https://...`
- `http://localhost`
- `http://127.0.0.1`

如果管理员后台仍然是公网 `http://IP`，启动 helper 前需要显式允许 backend origin：

```bash
export V_SAVE_ALLOWED_BACKEND_ORIGINS="http://<your-public-host-or-ip>"
cd companion
npm run dev
```

多域名可用逗号分隔。

## 常见故障

### 1. 前端显示“未检测到本机登录助手”

检查：

- `companion` 是否已启动
- `127.0.0.1:37219` 是否已监听
- Companion App 是否被 macOS 安全策略拦截

本机检查：

```bash
curl -H 'Origin: http://localhost:4871' \
  -H 'x-vsave-backend-origin: http://localhost:3001' \
  http://127.0.0.1:37219/health
```

如果是 split 部署，请把 `x-vsave-backend-origin` 改成真实 API origin，而不是前端页面 origin。

### 2. 点击按钮后 Chrome 没有启动

检查：

- `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` 是否存在
- 是否安装的是标准版 Google Chrome

### 3. 页面一直停留在等待状态

检查：

- `companion` 日志里是否已经拿到 `sessionid/sessionid_ss`
- backend `/api/douyin/auth/bridge/complete` 是否返回错误
- companion 是否允许当前后台域名

### 4. 服务端没有保存 Cookie

检查：

- `/api/douyin/auth/bridge/complete` 的返回内容
- backend 日志里是否提示 `uploadToken` 无效或 `缺少有效的抖音登录 Cookie`
- 当前 bridge session 是否已经过期

## 日志定位

建议同时观察：

- `~/Library/Logs/V-SAVE Companion/bridge.log`
- `backend` 容器日志
- 浏览器开发者工具里的网页登录态管理请求

## 部署影响

- 云服务器不再需要为抖音登录维护 Chromium / Xvfb / 图形环境
- 云服务器继续只运行 `backend + frontend + mysql`
- 抖音登录浏览器环境下沉到管理员本机
