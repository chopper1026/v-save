# Docker Local Deployment Guide

**Date:** 2026-03-24
**Workspace:** `<repo-root>`
**Scope:** Local/dev deployment for Web + Backend + Mobile API integration

## 1. 当前 Docker 口径

当前 `docker-compose.yml` 支持两种模式：

1. 默认模式（当前主用）
- 启动 `backend + frontend`
- 后端连接宿主机 MySQL（`host.docker.internal:3306`）

2. 可选模式（数据库容器化）
- 通过 `--profile with-mysql` 额外启动 `mysql`
- 后端需切换 `DATABASE_HOST=mysql`

说明：
- `mobile/` 不进 Docker
- `companion/` 不进 Docker
- 抖音网页登录态管理已不再依赖容器内图形浏览器、Xvfb 或服务端二维码流程

触发规则：
- 改动触达 `backend/` 或 `frontend/` 时，需要执行 Docker 重建
- 仅 `mobile/`、`companion/` 或文档改动时，可跳过 Docker 重建

## 2. 启动方式

### 2.1 默认模式（复用宿主机 MySQL）

```bash
cd <repo-root>
docker compose up -d --build
docker compose ps
```

期望状态：
- `v-save-backend`: `healthy`
- `v-save-frontend`: `healthy`

### 2.2 可选模式（Compose 内置 MySQL）

```bash
docker compose --profile with-mysql up -d --build
docker compose ps
```

## 3. 联调地址

- Web（浏览器）：`http://localhost:4871`
- Backend（给 Mobile）：`http://<LAN-IP>:3001/api`
- Backend（宿主机本地）：`http://localhost:3001/api`
- MySQL（默认本机）：`127.0.0.1:3306`
- MySQL（Compose 模式）：容器内 `mysql:3306`
- Companion 本机 helper：`http://127.0.0.1:37219`

## 4. 环境变量基线

### 4.1 Backend

基础配置：

- `PORT=3001`
- `CORS_ORIGINS`
- `JWT_SECRET`
- `JWT_EXPIRATION`
- `NODE_OPTIONS`
- `TZ=Asia/Shanghai`

数据库：

- 默认模式：`DATABASE_HOST=host.docker.internal`
- Compose MySQL：`DATABASE_HOST=mysql`
- 其他常规项：`DATABASE_PORT`、`DATABASE_USER`、`DATABASE_PASSWORD`、`DATABASE_NAME`、`DB_SYNCHRONIZE`

下载与运行时：

- `FFMPEG_PATH=ffmpeg`
- `FFPROBE_PATH=ffprobe`
- `YTDLP_PATH=yt-dlp`
- `PUBLIC_API_ORIGIN=`
- `YOUTUBE_NOEMBED_ENABLED=true`

抖音官方链路：

- `DOUYIN_ABOGUS_HELPER_PATH=/app/tools/douyin/abogus.py`
- `DOUYIN_ABOGUS_PYTHON`（可选，默认 `python3`）
- `DOUYIN_ABOGUS_TIMEOUT_MS`
- `DOUYIN_OFFICIAL_DETAIL_TIMEOUT_MS`
- `DOUYIN_PARSE_CACHE_TTL_MS`
- `DOUYIN_PARSE_MAX_ATTEMPTS`
- `DOUYIN_PARSE_RETRY_BASE_MS`
- `DOUYIN_PARSE_RETRY_JITTER_MS`
- `DOUYIN_PARSE_MIN_INTERVAL_MS`

浏览器与可执行文件路径：

- `PUPPETEER_EXECUTABLE_PATH`
- `KUAISHOU_CHROME_PATH`

说明：
- 当前后端已不再使用 `DOUYIN_QR_CHROME_PATH`。
- 抖音登录态维护主路径已经切到 `Companion App + /api/douyin/auth/bridge/*`。

### 4.2 Frontend

- 构建变量：`VITE_API_BASE_URL=/api`
- 对外端口：`4871 -> 80`
- `TZ=Asia/Shanghai`
- Nginx `/api/*` 反代 `backend:3001`

说明：
- 如果本地是 split 模式（例如前端 dev server 单独跑在 `localhost:3000`，后端跑在 `localhost:3001/api`），前端当前会以 `VITE_API_BASE_URL` 解析出的 API origin 传给本机 helper，不再强依赖 `window.location.origin`。

### 4.3 MySQL（profile: with-mysql）

- `TZ=Asia/Shanghai`
- 账号与库名由 compose 环境变量提供

### 4.4 Mobile

- `EXPO_PUBLIC_API_BASE_URL=http://<LAN-IP>:3001/api`
- 真机联调必须使用局域网 IP，不能使用 `localhost`

### 4.5 Companion

- 不在 Docker 中运行
- 本机默认监听：`127.0.0.1:37219`
- 默认只信任：
  - `https://...`
  - `http://localhost`
  - `http://127.0.0.1`
- 若管理员后台仍是公网 `http://IP`，启动前需要：

```bash
export V_SAVE_ALLOWED_BACKEND_ORIGINS="http://<your-public-host-or-ip>"
```

## 5. 当前镜像事实

### 5.1 Backend 镜像

当前 `backend/Dockerfile` 运行层内置：

- `ffmpeg`
- `yt-dlp`
- `curl`
- `chromium`
- `python3` / `python3-venv`
- `gmssl`（安装在 `/opt/douyin-python`）
- `tools/douyin/abogus.py`

说明：
- `yt-dlp` 仍保留给 YouTube / 小红书等平台使用。
- 抖音解析主链路依赖官方详情接口、服务端 Cookie 与 `a_bogus` helper，不依赖 Docker 内图形扫码环境。

### 5.2 Frontend 容器

- Nginx 托管静态资源
- `/api/*` 反代到 `backend:3001`

## 6. 时区校验（北京时间）

```bash
docker compose exec backend date
docker compose exec frontend date
docker compose --profile with-mysql exec mysql date
```

期望输出包含 `CST` 或 `+0800`。

## 7. 常用命令

```bash
docker compose ps
docker compose logs -f backend
docker compose logs -f frontend
docker compose restart backend frontend
docker compose down
```

## 8. 验证清单

1. `docker compose up -d --build` 后 backend/frontend 为 `healthy`。
2. 访问 `http://localhost:4871` 可打开首页。
3. Web 可完成 `parse -> get-url -> 下载`。
4. Backend 容器依赖可用：
- `docker compose exec backend ffmpeg -version`
- `docker compose exec backend yt-dlp --version`
- `docker compose exec backend python3 --version`
- `docker compose exec backend test -f /app/tools/douyin/abogus.py`
5. Mobile 使用局域网地址可登录并完成首页解析。
6. 抖音后台登录态健康时，已知样本解析可返回完整档位。
7. Runtime 看板可正常请求 `/api/admin/runtime-dashboard` 与 `/api/admin/runtime-dashboard/chains*`。
8. 下载模式切换后，Web/Mobile 的 `clientType` 分流行为符合预期。
9. 若需要测试抖音网页登录态管理扫码流程，需在宿主机额外启动 `companion/`，而不是在 Docker 内寻找扫码浏览器环境。

## 9. 常见故障排查

1. 后端连不上数据库：
- 确认 `DATABASE_HOST` 与当前模式一致。

2. Web 调 API 失败：
- 检查 `frontend` 反代配置与 `backend` 健康状态。
- 检查 `CORS_ORIGINS`。

3. Mobile 调用失败：
- 检查 `EXPO_PUBLIC_API_BASE_URL` 是否为局域网 IP。

4. 抖音解析直接报 `DOUYIN_SESSION_REQUIRED`：
- 说明服务端共享 Douyin Cookie 缺失或失效。
- 进入后台登录态管理页重新扫码或手动覆盖 Cookie。

5. Companion 显示未连接：
- 确认 `companion` 已启动
- 确认 `127.0.0.1:37219` 正在监听
- 确认 helper 允许当前 backend origin

6. 下载链接是相对 `/api/...`：
- 当前请求上下文拿不到外部 `host`，且未配置 `PUBLIC_API_ORIGIN`。

7. 抖音代理 `ENETUNREACH` 或长视频中断：
- 这仍是当前已知网络环境风险，需继续补充 IPv4 优先等兜底策略。
