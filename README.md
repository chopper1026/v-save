# V-SAVE

v-save是一个多平台视频下载器，目前支持抖音、b站、快手、小红书、Youtube平台的视频解析预览和下载，其中抖音和b站已接入官方接口实现了快速解析、多档画质、cdn直链下载，其他平台适配中。

## 功能特性

- 统一后端 API，覆盖 Web、ios 、companion 三端。
- 支持多平台解析、预览、下载任务创建、文件回取与合并下载。
- 支持多平台登录态管理，抖音、b站、快手均已实现官方网页版接口对接以获取更高画质，兼容服务器环境。
- 包含个人中心和后台管理。
- 提供一键部署脚本，自动适配国内外不同网络环境，可检测docker环境自动安装部署。
- ios端支持deeplink，抖音、b站分享链接跳转自动解析，无需手动切换app复制粘贴，提供静默下载模式可后台异步队列自动下载。

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

如果这条命令长时间没有任何输出，通常不是 `deploy.sh` 本身卡住，而是服务器访问 `raw.githubusercontent.com` 过慢或不可达。可改用 GitHub 仓库压缩包方式启动：

```bash
tmpdir="$(mktemp -d)" \
&& curl -fsSL https://github.com/chopper1026/v-save/archive/refs/heads/main.tar.gz -o "$tmpdir/v-save.tar.gz" \
&& tar -xzf "$tmpdir/v-save.tar.gz" -C "$tmpdir" \
&& bash "$tmpdir/v-save-main/scripts/deploy.sh" --force-region cn
```

常用参数：

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/chopper1026/v-save/main/scripts/deploy.sh) --public-host your.domain.com
bash <(curl -fsSL https://raw.githubusercontent.com/chopper1026/v-save/main/scripts/deploy.sh) --install-dir /opt/v-save
bash <(curl -fsSL https://raw.githubusercontent.com/chopper1026/v-save/main/scripts/deploy.sh) --force-region cn
bash <(curl -fsSL https://raw.githubusercontent.com/chopper1026/v-save/main/scripts/deploy.sh) --refresh-repo
bash <(curl -fsSL https://raw.githubusercontent.com/chopper1026/v-save/main/scripts/deploy.sh) --image-tag latest
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
- 生成随机数据库密码、`JWT_SECRET`，以及首次初始化用的超级管理员密码。
- 写入部署目录下的 `.env` 与 `backend/.env`。
- 拉起 `frontend + backend + mysql`。
- 输出访问地址、数据库用户名，以及首次生成的超级管理员密码。

补充说明：

- 如果服务器没有安装 `git`，脚本会使用仓库压缩包部署；再次运行时默认复用现有安装目录，不会每次都重新下载。
- 如果服务器安装了 `git`，再次运行脚本时也会默认复用当前安装目录中的现有代码；只有显式加上 `--refresh-repo` 时，才会执行 `git fetch && git pull`。
- 脚本默认直接拉取 Docker Hub 上的官方 `latest` 镜像部署，不会在服务器本地构建镜像；如果需要固定版本或回滚，可通过 `--image-tag` 或 `V_SAVE_IMAGE_TAG` 指定 tag。
- 注册入口默认关闭。部署完成后可用自动生成的超管账号登录后台，在“系统设置”里手动开启注册入口。
- 一键部署默认超管邮箱是 `admin@gmail.com`；密码仅首次生成时会在终端摘要里明文显示一次，后续重跑脚本不会重置也不会再次回显。

### 方式二：预构建镜像发布到 Docker Hub

适合把镜像在本地或 GitHub Actions 中提前构建好，再让服务器只执行 `pull + up -d`。一键部署脚本现在默认就会走这条路径，并从 Docker Hub 拉取官方镜像。

仓库已提供生产专用 Compose 文件 [`docker-compose.release.yml`](./docker-compose.release.yml) 和 Docker Hub 发布工作流 [`docker-publish.yml`](./.github/workflows/docker-publish.yml)。

#### 1. 配置 GitHub Actions

在 GitHub 仓库中准备下面这些配置：

- Secrets:
  - `DOCKERHUB_USERNAME`
  - `DOCKERHUB_TOKEN`
- Variables:
  - `V_SAVE_BACKEND_IMAGE`，例如 `yourname/v-save-backend`
  - `V_SAVE_FRONTEND_IMAGE`，例如 `yourname/v-save-frontend`
  - 可选：`V_SAVE_NPM_REGISTRY`、`V_SAVE_APT_MIRROR`、`V_SAVE_APT_SECURITY_MIRROR`、`V_SAVE_PIP_INDEX_URL`、`V_SAVE_ALPINE_MIRROR`、`V_SAVE_VITE_API_BASE_URL`

工作流会在推送 `main` 分支或 `v*` tag 时，自动构建并推送多架构镜像到 Docker Hub，同时生成：

- `latest`
- Git commit short SHA
- Git tag 名（仅 tag 发布时）

#### 2. 服务器侧使用预构建镜像部署

服务器默认会从 Docker Hub 拉取：

- `chopper1026/v-save-backend:latest`
- `chopper1026/v-save-frontend:latest`

如果你需要显式覆盖镜像名或 tag，可传参：

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/chopper1026/v-save/main/scripts/deploy.sh) \
  --backend-image yourname/v-save-backend \
  --frontend-image yourname/v-save-frontend \
  --image-tag latest
```

也可以先写环境变量，再执行脚本：

```bash
export V_SAVE_BACKEND_IMAGE=yourname/v-save-backend
export V_SAVE_FRONTEND_IMAGE=yourname/v-save-frontend
export V_SAVE_IMAGE_TAG=latest

bash <(curl -fsSL https://raw.githubusercontent.com/chopper1026/v-save/main/scripts/deploy.sh)
```

启用该模式后，服务器只会：

- 拉起 `mysql`
- `pull` 后端与前端镜像
- 使用 `docker-compose.release.yml` 启动容器

如果需要回滚，只要把 `V_SAVE_IMAGE_TAG` 改成旧版本 tag 或旧的 git SHA，再重新执行脚本。

### 方式三：源码开发

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
- `SUPER_ADMIN_EMAILS`
- `SUPER_ADMIN_BOOTSTRAP_EMAIL`
- `SUPER_ADMIN_BOOTSTRAP_PASSWORD`
- `SUPER_ADMIN_BOOTSTRAP_NICKNAME`

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
- `GET /api/system-settings/public`

### 后台系统设置

- `GET /api/admin/system-settings`
- `PUT /api/admin/system-settings`

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
- 部署脚本会生成随机密钥；数据库密码会在当前部署终端摘要里显示，超级管理员初始化密码只会在首次生成时明文显示一次，`JWT_SECRET` 仅写入配置文件。

## 其他说明

- Mobile 详细说明见 `mobile/README.md`
- Companion 详细说明见 `companion/README.md`

## License

[MIT](./LICENSE)
