# Docker Local Deployment Guide

> Archived on 2026-03-19. Latest guide: `docs/plans/2026-03-22-docker-deployment-guide.md`.

**Date:** 2026-03-18  
**Workspace:** `<repo-root>`  
**Scope:** Local/dev deployment for Web + Backend + Mobile API integration

## 1. 目标与当前口径

当前 `docker-compose.yml` 保持两种模式：

1. 默认模式（推荐，当前主用）
- 启动 `backend + frontend`
- 后端连接宿主机 MySQL（`host.docker.internal:3306`）

2. 可选模式（数据库容器化）
- 通过 `--profile with-mysql` 额外启动 `mysql`
- 后端应切换 `DATABASE_HOST=mysql`

> 触发规则：仅当改动触达 `backend/` 或 `frontend/` 时需要执行 Docker 重建；仅 iOS 或文档改动可跳过。

## 2. 启动方式

### 2.1 默认模式（复用本机 MySQL）

```bash
cd <repo-root>
docker compose up -d --build
docker compose ps
```

期望状态：
- `v-save-backend`: healthy
- `v-save-frontend`: healthy

### 2.2 可选模式（Compose 内置 MySQL）

```bash
docker compose --profile with-mysql up -d --build
docker compose ps
```

## 3. 双端联调地址

- Web（浏览器）：`http://localhost:4871`
- Backend（给 Mobile）：`http://<LAN-IP>:3001/api`
- MySQL（默认本机）：`127.0.0.1:3306`
- MySQL（Compose 模式）：容器内 `mysql:3306`，宿主机映射默认 `127.0.0.1:3306`

## 4. 环境变量基线

### 4.1 Backend

- `PORT=3001`
- `CORS_ORIGINS`（逗号分隔）
- `FFMPEG_PATH=ffmpeg`
- `YTDLP_PATH=yt-dlp`
- `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser`
- `TZ=Asia/Shanghai`

抖音探测与代理（按需覆盖，默认可用）：

- `DOUYIN_STRICT_PROBE_CONCURRENCY`（默认 `2`）
- `DOUYIN_STRICT_PROBE_BUDGET_MS`（默认 `9000`）
- `DOUYIN_SMART_PROBE_BUDGET_MS`（默认 `1800`）
- `PROXY_UPSTREAM_CONNECT_TIMEOUT_MS`（默认 `20000`）
- `PROXY_UPSTREAM_STREAM_IDLE_TIMEOUT_MS`（默认 `300000`）

数据库：

- 默认模式：`DATABASE_HOST=host.docker.internal`
- Compose MySQL：`DATABASE_HOST=mysql`

### 4.2 Frontend

- 对外端口：`4871 -> 80`
- 构建变量：`VITE_API_BASE_URL=/api`
- `TZ=Asia/Shanghai`
- Nginx `/api/*` 反代 `backend:3001`

### 4.3 MySQL（profile: with-mysql）

- `TZ=Asia/Shanghai`

### 4.4 Mobile

- `EXPO_PUBLIC_API_BASE_URL=http://<LAN-IP>:3001/api`
- 真机联调必须使用局域网 IP，不能使用 `localhost`

## 5. 时区校验（北京时间）

```bash
docker compose exec backend date
docker compose exec frontend date
# 仅 with-mysql 启用时可执行
docker compose --profile with-mysql exec mysql date
```

期望输出包含 `CST` 或 `+0800`，且日期时间与北京时间一致。

## 6. 常用命令

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

## 7. 验证清单

1. `docker compose up -d --build` 后 backend/frontend 为 healthy。
2. 访问 `http://localhost:4871` 可打开首页。
3. Web 可完成 `parse -> get-url -> 下载`。
4. Backend 容器依赖可用：
- `docker compose exec backend ffmpeg -version`
- `docker compose exec backend yt-dlp --version`
- `docker compose exec backend which chromium-browser`
5. Mobile 使用局域网地址可登录并完成首页解析。
6. 长视频下载不应因“固定硬超时”中途失败（重点验证抖音）。

## 8. 常见故障排查

1. 后端连不上数据库：
- 确认 `DATABASE_HOST` 与当前模式一致（`host.docker.internal` 或 `mysql`）。

2. Web 调 API 失败：
- 检查 `frontend/nginx.conf` 反代配置与 backend 健康状态。

3. Mobile 调用失败：
- 检查 `EXPO_PUBLIC_API_BASE_URL` 是否为局域网 IP。
- 检查 `CORS_ORIGINS` 是否包含调试来源。

4. 抖音长视频失败/超时：
- 观察 backend 日志是否为上游连接超时或流空闲超时。
- 结合网络情况调大 `PROXY_UPSTREAM_CONNECT_TIMEOUT_MS` / `PROXY_UPSTREAM_STREAM_IDLE_TIMEOUT_MS`。

5. 抖音代理 `ENETUNREACH`：
- 属于当前已知网络环境风险，需在网络栈继续补充 IPv4 优先兜底。
