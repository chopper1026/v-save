# Docker Local Deployment Guide

> Archived on 2026-03-20. Latest guide: `docs/plans/2026-03-22-docker-deployment-guide.md`.

**Date:** 2026-03-19  
**Workspace:** `<repo-root>`  
**Scope:** Local/dev deployment for Web + Backend + Mobile API integration

> 本文档记录 2026-03-19 的 Docker 联调口径，仅用于回溯，不作为当前实施依据。

## 1. 当日目标与口径

当时 `docker-compose.yml` 保持两种模式：

1. 默认模式（推荐，主用）
- 启动 `backend + frontend`
- 后端连接宿主机 MySQL（`host.docker.internal:3306`）

2. 可选模式（数据库容器化）
- 通过 `--profile with-mysql` 额外启动 `mysql`
- 后端切换 `DATABASE_HOST=mysql`

## 2. 当日联调地址

- Web（浏览器）：`http://localhost:4871`
- Backend（给 Mobile）：`http://<LAN-IP>:3001/api`
- MySQL（默认本机）：`127.0.0.1:3306`

## 3. 历史说明

- 当前 Docker 口径请以 `docs/plans/2026-03-22-docker-deployment-guide.md` 为准。
- `PUBLIC_API_ORIGIN`、`YOUTUBE_NOEMBED_ENABLED`、统一可执行文件路径解析等后续配置不在本文档覆盖范围内。
