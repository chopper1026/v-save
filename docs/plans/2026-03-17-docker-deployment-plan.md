# Docker Local Deployment Guide

> Archived on 2026-03-18. Latest guide: `docs/plans/2026-03-22-docker-deployment-guide.md`.

**Date:** 2026-03-17  
**Workspace:** `<repo-root>`  
**Scope:** Local/dev deployment for Web + Backend + Mobile API integration

## 1. 目标与现状

当前 `docker-compose.yml` 已落地两种模式：

1. 默认模式（推荐，当前团队实际使用）
- 启动 `backend + frontend`
- 后端连接宿主机 MySQL（`host.docker.internal:3306`）
- 适合本机已有 MySQL 的联调环境

2. 可选模式（需要时启用）
- 通过 `--profile with-mysql` 额外启动 `mysql` 容器
- 适合希望数据库也容器化的本地环境

## 2. 启动方式

### 2.1 默认模式（本机 MySQL）

```bash
cd <repo-root>
docker compose up -d --build
docker compose ps
```

期望状态：
- `v-save-backend`: healthy
- `v-save-frontend`: healthy

### 2.2 可选模式（Compose MySQL）

```bash
docker compose --profile with-mysql up -d --build
docker compose ps
```

若启用该模式，需确保后端使用 `DATABASE_HOST=mysql`。

## 3. 访问地址口径（双端联调）

- Web（浏览器）：`http://localhost:4871`
- Backend 直连（给 Mobile）：`http://<LAN-IP>:3001/api`
- MySQL（默认本机）：`127.0.0.1:3306`
- MySQL（Compose 模式）：容器内 `mysql:3306`，宿主机映射默认 `127.0.0.1:3306`

## 4. 配置基线

### 4.1 Backend

- `PORT=3001`
- `CORS_ORIGINS`：逗号分隔白名单
- `FFMPEG_PATH=ffmpeg`
- `YTDLP_PATH=yt-dlp`
- `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser`

数据库变量：
- 默认模式：`DATABASE_HOST=host.docker.internal`
- Compose MySQL 模式：`DATABASE_HOST=mysql`

### 4.2 Frontend

- 对外端口：`4871 -> 80`
- 构建变量：`VITE_API_BASE_URL=/api`
- Nginx `/api/*` 反代到 `backend:3001`
- React Router 刷新回退已配置（`try_files ... /index.html`）

### 4.3 Mobile

- `EXPO_PUBLIC_API_BASE_URL=http://<LAN-IP>:3001/api`
- 真机联调时不可使用 `localhost`
- 需要将调试来源加入后端 `CORS_ORIGINS`

## 5. 持久化

- `backend_tmp`：后端任务与临时目录（`/app/tmp`）
- `mysql_data`：仅在启用 `with-mysql` profile 时使用

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

1. `docker compose up -d --build` 后服务为 healthy/running。
2. 访问 `http://localhost:4871`，Web 页面可打开。
3. 通过前端触发 `/api/download/parse`、`/api/download/get-url` 能返回。
4. 容器内依赖检查：
- `docker compose exec backend ffmpeg -version`
- `docker compose exec backend yt-dlp --version`
- `docker compose exec backend which chromium-browser`
5. Mobile 使用局域网地址可登录并完成首页解析。

## 8. 常见故障排查

1. 后端连不上数据库：
- 默认模式确认本机 MySQL 正常监听 `3306`。
- 检查 `DATABASE_HOST` 是否与当前模式匹配（`host.docker.internal` 或 `mysql`）。

2. Web 调 API 失败：
- 确认前端端口是 `4871`。
- 检查 `frontend/nginx.conf` 的 `/api` 反代与后端健康状态。

3. Mobile 调用失败：
- 检查 `EXPO_PUBLIC_API_BASE_URL` 是否使用主机 LAN IP。
- 检查 `CORS_ORIGINS` 是否包含调试来源。

4. 下载链路失败：
- 进入 backend 容器确认 `ffmpeg`、`yt-dlp`、`chromium-browser` 可执行。
- 对目标平台检查登录态是否有效（尤其 B站高画质）。
