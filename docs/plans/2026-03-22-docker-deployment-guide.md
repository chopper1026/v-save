# Docker Local Deployment Guide

> Superseded on 2026-03-24. Latest guide: `docs/plans/2026-03-24-docker-deployment-guide.md`.

**Date:** 2026-03-22  
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

触发规则：
- 改动触达 `backend/` 或 `frontend/` 时，需要执行 Docker 重建
- 仅 `mobile/` 或文档改动时，可跳过 Docker 重建

## 2. 启动方式

### 2.1 默认模式（复用宿主机 MySQL）

```bash
cd <repo-root>
docker compose up -d --build
docker compose ps
```

期望状态：
- `video-downloader-backend`: `healthy`
- `video-downloader-frontend`: `healthy`

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
- MySQL（Compose 模式）：容器内 `mysql:3306`，宿主机映射默认 `127.0.0.1:3306`

## 4. 环境变量基线

### 4.1 Backend

基础配置：

- `PORT=3001`
- `CORS_ORIGINS`（逗号分隔）
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
- `DOUYIN_ABOGUS_TIMEOUT_MS`（可选，默认 10000ms）
- `DOUYIN_OFFICIAL_DETAIL_TIMEOUT_MS`（可选，默认 20000ms）
- `DOUYIN_PARSE_CACHE_TTL_MS`
- `DOUYIN_PARSE_MAX_ATTEMPTS`
- `DOUYIN_PARSE_RETRY_BASE_MS`
- `DOUYIN_PARSE_RETRY_JITTER_MS`
- `DOUYIN_PARSE_MIN_INTERVAL_MS`

浏览器与可执行文件路径：

- `PUPPETEER_EXECUTABLE_PATH`
- `KUAISHOU_CHROME_PATH`

说明：
- 抖音官方详情链路当前强依赖服务端抖音 Cookie 与本地 `a_bogus` helper。
- `a_bogus` 当前由 Node 侧长驻 Python worker 复用本地 helper 生成，不存在运行时从 GitHub 在线拉取脚本。
- 如果下载接口拿不到请求头里的 `host`，会尝试用 `PUBLIC_API_ORIGIN` 把相对 `/api/...` 下载链接补成绝对地址。
- Chrome / Chromium / `yt-dlp` 路径解析已统一走 `backend/src/config/executable-paths.ts`。

### 4.2 Frontend

- 构建变量：`VITE_API_BASE_URL=/api`
- 对外端口：`4871 -> 80`
- `TZ=Asia/Shanghai`
- Nginx `/api/*` 反代 `backend:3001`

### 4.3 MySQL（profile: with-mysql）

- `TZ=Asia/Shanghai`
- 账号与库名默认由 compose 环境变量提供

### 4.4 Mobile

- `EXPO_PUBLIC_API_BASE_URL=http://<LAN-IP>:3001/api`
- 真机联调必须使用局域网 IP，不能使用 `localhost`

## 5. 当前镜像事实

### 5.1 Backend 镜像

当前 `backend/Dockerfile` 为多阶段构建，运行层内置：

- `ffmpeg`
- `yt-dlp`
- `curl`
- `chromium`
- `python3` / `python3-venv`
- `gmssl`（安装在 `/opt/douyin-python`）
- `tools/douyin/abogus.py`

说明：
- `yt-dlp` 仍保留在镜像中，供 YouTube / 小红书等平台使用。
- 抖音解析主链路当前不再依赖 `yt-dlp`，而是依赖官方详情接口、Cookie 与 `a_bogus` helper。
- `a_bogus` helper 已固化在镜像内，运行态通过本地 worker 复用，避免逐次起 Python 进程。

### 5.2 Frontend 容器

- 当前由 Nginx 托管静态资源
- `/api/*` 反代到 `backend:3001`

## 6. 时区校验（北京时间）

```bash
docker compose exec backend date
docker compose exec frontend date
# 仅 with-mysql 启用时可执行
docker compose --profile with-mysql exec mysql date
```

期望输出包含 `CST` 或 `+0800`，且与北京时间一致。

## 7. 常用命令

```bash
# 查看状态
docker compose ps

# 查看日志
docker compose logs -f backend
docker compose logs -f frontend

# 重启
docker compose restart backend frontend

# 停止并保留卷
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
6. 抖音后台登录态健康时，已知 4K 样本解析可直接返回完整档位。  
7. Runtime 看板可正常请求 `/api/admin/runtime-dashboard` 与 `/api/admin/runtime-dashboard/chains*`。  
8. 下载模式切换后，Web/Mobile 的 `clientType` 分流行为符合预期。  
9. 当处于反向代理或容器外调用环境时，若需要绝对下载链接，已正确配置 `PUBLIC_API_ORIGIN`。  

## 9. 常见故障排查

1. 后端连不上数据库：
- 确认 `DATABASE_HOST` 与当前模式一致（`host.docker.internal` 或 `mysql`）。

2. Web 调 API 失败：
- 检查 `frontend` 反代配置与 `backend` 健康状态。
- 检查 `CORS_ORIGINS` 是否包含调试来源。

3. Mobile 调用失败：
- 检查 `EXPO_PUBLIC_API_BASE_URL` 是否为局域网 IP。
- 检查真机与宿主机是否处于同一局域网。

4. 抖音解析直接报 `DOUYIN_SESSION_REQUIRED`：
- 说明服务端抖音登录态缺失或失效。
- 进入后台登录态管理页重新录入或刷新抖音会话。

5. 抖音官方详情失败：
- 观察 backend 日志，区分是 Cookie 失效、`a_bogus` helper 异常、官方接口字段变化还是网络超时。
- 检查容器内 `/app/tools/douyin/abogus.py` 是否存在，Python venv 是否可用。

6. 下载链接是相对 `/api/...`：
- 说明当前请求上下文拿不到外部 `host`，且未配置 `PUBLIC_API_ORIGIN`。
- 如果需要给外部客户端消费绝对地址，请补充 `PUBLIC_API_ORIGIN`。

7. 抖音代理 `ENETUNREACH` 或长视频中断：
- 观察 backend 日志，判断是连接超时、流空闲超时还是上游异常。
- 这仍是当前已知网络环境风险，后续需继续补充 IPv4 优先等兜底策略。
