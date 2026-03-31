# V-SAVE

多平台视频解析、预览、下载与登录态管理工具，包含 Web 用户端、后台管理、Mobile App，以及用于抖音扫码登录桥接的 macOS Companion。

## 功能特性

- 统一后端 API，覆盖 Web、管理后台、Mobile 三个客户端。
- 支持多平台解析、预览、下载任务创建、文件回取与合并下载。
- 提供 B 站与抖音登录态管理，抖音支持 Companion 扫码桥接。
- 内置通知中心、下载模式管理、运行态埋点与 Runtime 看板。
- 提供一键部署脚本，适合服务器快速拉起 `frontend + backend + mysql`。

## 项目结构

| 目录 | 说明 |
| --- | --- |
| `backend/` | NestJS 后端，负责认证、解析、下载、通知、后台治理、Runtime 监控 |
| `frontend/` | Vite + React Web 用户端与管理后台 |
| `mobile/` | Expo + React Native 移动端 |
| `companion/` | macOS 本机登录桥接工具，负责拉起 Chrome 完成抖音扫码 |
| `scripts/` | 部署与运维脚本 |

## 技术栈

- Backend: NestJS、TypeORM、MySQL、Axios、Puppeteer Core
- Frontend: Vite、React、Tailwind CSS、Zustand、Vitest
- Mobile: Expo、React Native、expo-router、SecureStore
- Companion: SwiftUI / AppKit、Chrome DevTools Protocol

## 部署方式

### 方式一：一键部署（推荐）

适合服务器直接部署完整服务栈：

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/chopper1026/v-save/main/scripts/deploy.sh)
```

常用参数：

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/chopper1026/v-save/main/scripts/deploy.sh) --public-host your.domain.com
bash <(curl -fsSL https://raw.githubusercontent.com/chopper1026/v-save/main/scripts/deploy.sh) --install-dir /opt/v-save
bash <(curl -fsSL https://raw.githubusercontent.com/chopper1026/v-save/main/scripts/deploy.sh) --force-region cn
```

如果服务器位于中国大陆，脚本会优先从 Docker 官方 GitHub 仓库下载安装脚本，并默认使用 `AzureChinaCloud` 安装镜像。若你需要手动覆盖，可这样执行：

```bash
export V_SAVE_DOCKER_INSTALL_SCRIPT_URL_CN="https://raw.githubusercontent.com/docker/docker-install/master/install.sh"
export V_SAVE_DOCKER_INSTALL_MIRROR_CN="AzureChinaCloud"
bash <(curl -fsSL https://raw.githubusercontent.com/chopper1026/v-save/main/scripts/deploy.sh) --force-region cn
```

脚本会自动完成：

- 检测架构并选择合适的 Docker 镜像。
- 在中国大陆网络环境下自动启用镜像加速。
- 检查 Docker / Docker Compose。
- 生成随机数据库密码与 `JWT_SECRET`。
- 写入部署目录下的 `.env` 与 `backend/.env`。
- 拉起 `frontend + backend + mysql`。
- 输出访问地址、数据库用户名和随机生成的数据库密码。

### 方式二：源码开发

#### 1. 安装依赖

```bash
cd backend && npm install
cd ../frontend && npm install
cd ../mobile && npm install --legacy-peer-deps
cd ../companion && npm install
```

#### 2. 启动后端

```bash
cd backend
cp .env.example .env
```

把 `backend/.env` 中的 `JWT_SECRET` 改成至少 24 位随机字符串，再启动：

```bash
npm run start:dev
```

后端默认地址：`http://localhost:3001/api`

#### 3. 启动 Web

```bash
cd frontend
npm run dev
```

Web 默认地址：`http://localhost:3000`

#### 4. 启动 Mobile

```bash
cd mobile
cp .env.example .env
npm run typecheck
npm run prebuild
npm run ios
# 或 npm run android
```

注意：

- `EXPO_PUBLIC_API_BASE_URL` 必须指向手机能访问的后端地址。
- 真机调试不要使用 `localhost`，请改成 `http://<LAN-IP>:3001/api`。

#### 5. 启动 Companion

```bash
cd companion
npm run generate:xcodeproj
npm run dev
```

Companion 默认仅监听本机：`http://127.0.0.1:37219`

### 方式三：Docker Compose 本地联调

适合本机调试 Web + Backend：

```bash
cp backend/.env.docker.example backend/.env
```

然后至少完成两项配置：

1. 把 `backend/.env` 里的 `JWT_SECRET` 改成真实随机值。
2. 按你的数据库环境修改 `DATABASE_HOST / DATABASE_USER / DATABASE_PASSWORD`。

如果你只是想拉起前后端容器：

```bash
docker compose up -d --build
docker compose ps
```

如果你要连同 MySQL 一起拉起，推荐直接使用上面的一键部署脚本，因为它会自动生成并对齐根目录 `.env`、`backend/.env`、MySQL 账号和后端连接配置，避免手工配置不一致。

## 关键环境变量

### Backend

- `JWT_SECRET`
  必填，必须使用强随机值。当前版本会拒绝公开默认值或占位值启动。
- `DATABASE_HOST`
- `DATABASE_PORT`
- `DATABASE_USER`
- `DATABASE_PASSWORD`
- `DATABASE_NAME`
- `CORS_ORIGINS`
- `PUBLIC_API_ORIGIN`
- `WEB_PUBLIC_ORIGIN`

参考文件：

- `backend/.env.example`
- `backend/.env.docker.example`

### Mobile

- `EXPO_PUBLIC_API_BASE_URL`

参考文件：

- `mobile/.env.example`

## 常用命令

### Backend

```bash
cd backend
npm run lint
npm run test
npx jest src/download/download.service.spec.ts --runInBand
```

### Frontend

```bash
cd frontend
npm run lint
npm run test
npx vitest run src/hooks/useDouyinBridgeAuth.test.ts
```

### Mobile

```bash
cd mobile
npm run typecheck
```

### Companion

```bash
cd companion
npm test
```

### 部署脚本自检

```bash
bash scripts/deploy.test.sh
```

## API 简览

### 认证

- `POST /api/auth/register`
- `POST /api/auth/login`

### 下载主链路

- `POST /api/download/parse`
- `POST /api/download/get-url`
- `POST /api/download/create-task`
- `GET /api/download/tasks/:id`
- `GET /api/download/tasks/:id/file`
- `GET /api/download/merge`

### 用户

- `GET /api/users/profile`
- `PATCH /api/users/profile`
- `PATCH /api/users/account/password`
- `PATCH /api/users/account/phone`

### 抖音登录态管理（仅超级管理员）

- `GET /api/douyin/auth/status`
- `POST /api/douyin/auth/session`
- `DELETE /api/douyin/auth/session`
- `POST /api/douyin/auth/bridge/start`
- `GET /api/douyin/auth/bridge/status`
- `POST /api/douyin/auth/bridge/complete`

## 安全说明

- 仓库不包含已跟踪的真实 `.env`、私钥或第三方服务密钥。
- Web 端登录态只保存在 `sessionStorage`，不会再把明文密码写入浏览器持久存储。
- 抖音登录态管理页不再显示 Cookie 片段。
- 部署脚本会生成随机密钥；数据库密码会在当前部署终端摘要里显示一次，`JWT_SECRET` 仅写入配置文件。

## 其他说明

- Mobile 详细说明见 `mobile/README.md`
- Companion 详细说明见 `companion/README.md`

## License

[MIT](./LICENSE)
