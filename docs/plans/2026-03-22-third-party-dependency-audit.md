# V-SAVE 第三方依赖审计

**Date:** 2026-03-22  
**Workspace:** `<repo-root>`  
**Scope:** Backend / Frontend / Mobile / Docker / Local Tooling

## 1. 结论摘要

当前项目的第三方依赖可分为 4 类：

1. 外部平台网站与 API  
2. 本地部署依赖与命令行工具  
3. 容器与基础设施依赖  
4. 顶层 npm / Expo / React Native 依赖  

其中风险最高的不是普通 npm 包，而是“平台侧非自有能力”：

- 抖音：服务端 Cookie + `a_bogus` + 官方详情接口
- 快手：网页抓取 + GraphQL + `puppeteer-core`
- 小红书：网页/API 混合抓取，必要时依赖 `yt-dlp`
- YouTube：页面解析 + `yt-dlp`，并保留 `noembed` 可选补充
- B站：登录态与播放地址依赖官方接口

这些依赖一旦页面结构、风控策略、签名算法、Cookie 规则或接口字段变化，会直接影响核心业务可用性。

## 2. 风险分级口径

- `高`：外部平台私有接口、抓取、登录态、浏览器自动化、签名算法依赖
- `中`：本地命令行工具、运行时二进制、容器内基础设施
- `低`：常规框架/UI/状态管理/工具类包

## 3. 外部平台网站 / API / CDN 依赖

| 依赖项 | 当前用途 | 风险 | 是否可去依赖 | 替代 / 缓解建议 |
| --- | --- | --- | --- | --- |
| Douyin `aweme/detail` 官方接口 | 抖音解析主链路唯一事实源 | 高 | 短期不可 | 继续隔离在 `douyin-official/` 模块；补签名 helper 健康检查、字段漂移监控、回归样本集 |
| Douyin 登录页 / 二维码流程 | 后台录入和刷新抖音登录态 | 高 | 短期不可 | 保持后台管理独立；增加 Cookie 过期预警与人工补录 SOP |
| Douyin 视频 / 图片 CDN (`aweme.snssdk.com`, `douyinpic.com`) | 预览、下载、代理回退 | 高 | 不可 | 保持 `proxy/` 统一转发；继续完善 `play -> playwm`、超时、IPv4 优先等兜底 |
| Bilibili Passport / Play 接口 | B站扫码登录、Cookie 健康检查、播放地址获取 | 高 | 短期不可 | 抽象 provider 边界；对登录态与播放地址分别加回归脚本 |
| Bilibili 页面地址 / `correspond` | 登录确认和部分登录态流程 | 高 | 可部分降低 | 尽量把页面依赖收口在登录态模块；减少页面级耦合 |
| Xiaohongshu Web 页面 / Notes API (`edith.xiaohongshu.com`) | 笔记解析、视频地址提取 | 高 | 短期不可 | 继续优先官方/稳定接口；把页面抓取视为 fallback；保留样本回归 |
| Xiaohongshu CDN (`xhscdn.com`) | 预览 / 下载资源 | 中 | 不可 | 继续经代理层收口来源头与错误码 |
| Kuaishou Web 页面 / GraphQL | 快手分享页解析与内容提取 | 高 | 短期不可 | 收口在单 parser；保留浏览器抓取作为兜底，不把逻辑散到业务层 |
| Kuaishou CDN (`kwaicdn.com`, `ndcimgs.com`) | 资源预览与下载 | 中 | 不可 | 继续用代理层统一来源头与错误处理 |
| YouTube 页面 / `img.youtube.com` | 标题、封面、基础信息与资源地址解析 | 高 | 部分可 | 将页面解析和封面策略统一放在 `youtube.parser`，避免多处分散请求 |
| `noembed.com` | YouTube 补充元数据，当前可通过环境变量关闭 | 中 | 可 | 保持默认可关闭；建议长期从默认链路中继续弱化，避免可用性受第三方服务影响 |

## 4. 本地运行工具 / 可执行文件依赖

| 依赖项 | 当前用途 | 风险 | 是否可去依赖 | 替代 / 缓解建议 |
| --- | --- | --- | --- | --- |
| `ffmpeg` | 音视频合流、iOS 兼容转码 | 中 | 短期不可 | 固化版本；增加容器内可执行自检；把调用集中在下载服务 |
| `ffprobe` | 抖音等链路的媒体探测 | 中 | 可部分降低 | 仅在必要场景调用；加强探测超时与失败降级 |
| `yt-dlp` | YouTube / 小红书等平台补充解析或异步下载 | 高 | 可部分降低 | 继续压缩使用范围；优先官方/稳定链路；固定版本并做回归验证 |
| Chromium / `puppeteer-core` | 快手抓取、抖音/B站登录态流程 | 高 | 短期不可 | 保持路径统一由配置层解析；减少页面级脚本散落 |
| Python3 + `gmssl` + `abogus.py` | 抖音 `a_bogus` 签名 helper（当前由本地常驻 worker 复用） | 高 | 短期不可 | 继续仓库内固化 helper；加 helper 存在性、worker 启动与超时健康检查；明确无运行时 GitHub 拉取 |
| MySQL | 主业务库 | 中 | 不可 | 继续保留本机 MySQL 与 compose MySQL 双模式；补备份与迁移说明 |
| Expo Dev Client / 原生能力 | 分享扩展、相册、文件系统、通知等移动端能力 | 中 | 短期不可 | 继续保持 Mobile 与 Web API 契约分离但同步验证 |

## 5. 容器与基础设施依赖

| 依赖项 | 当前用途 | 风险 | 是否可去依赖 | 替代 / 缓解建议 |
| --- | --- | --- | --- | --- |
| Docker / Docker Compose | 本地 `backend + frontend` 联调基线 | 中 | 可 | 源码模式可替代，但不建议去除 compose 基线 |
| Nginx | Frontend 静态托管与 `/api` 反代 | 低 | 可 | 本地开发可直接走 Vite proxy；Docker 发布态仍建议保留 |
| `host.docker.internal` | 默认容器连接宿主机 MySQL | 中 | 可 | 如需更稳定隔离，可切换 `with-mysql` profile |
| Compose MySQL profile | 容器内 MySQL | 低 | 可 | 作为可选方案保留即可 |

## 6. 顶层 npm / Expo 依赖清单

以下为仓库内“顶层直接依赖”口径，不含传递依赖。

### 6.1 Backend

#### 业务运行依赖

- NestJS：`@nestjs/common`、`@nestjs/config`、`@nestjs/core`、`@nestjs/jwt`、`@nestjs/passport`、`@nestjs/platform-express`、`@nestjs/typeorm`
- 数据与认证：`typeorm`、`mysql2`、`passport`、`passport-jwt`、`bcrypt`
- 抓取/请求/解析：`axios`、`cheerio`、`puppeteer-core`、`user-agents`
- 运行基础：`reflect-metadata`、`rxjs`
- 历史兼容残留：`sqlite3`

#### 开发依赖

- 类型与测试：`jest`、`supertest`、`ts-jest`、`@nestjs/testing`
- 代码质量：`eslint`、`prettier`、`@typescript-eslint/*`
- 构建与 TS 工具：`ts-node`、`ts-loader`、`tsconfig-paths`、`typescript`

### 6.2 Frontend

#### 运行依赖

- 核心框架：`react`、`react-dom`、`react-router-dom`
- 请求与状态：`axios`、`zustand`
- 可视化与交互：`recharts`、`framer-motion`、`lucide-react`
- 媒体与显示：`hls.js`
- 其他：`qrcode.react`

#### 开发依赖

- 构建：`vite`、`@vitejs/plugin-react`
- 样式：`tailwindcss`、`postcss`、`autoprefixer`
- 测试 / 自动化：`playwright`、`vitest`
- 类型：`typescript`、`@types/react`、`@types/react-dom`

### 6.3 Mobile

#### 运行依赖

- Expo / React Native：`expo`、`expo-router`、`react-native`、`react-native-web`
- 设备与系统能力：`expo-clipboard`、`expo-file-system`、`expo-image-picker`、`expo-linking`、`expo-media-library`、`expo-notifications`、`expo-secure-store`、`expo-sharing`
- 分享与视频：`expo-share-intent`、`expo-video`
- UI / 交互：`@expo/vector-icons`、`@backpackapp-io/react-native-toast`、`react-native-gesture-handler`、`react-native-reanimated`、`react-native-safe-area-context`、`react-native-screens`、`react-native-worklets`
- 请求与状态：`axios`、`zustand`

#### 开发依赖

- `babel-preset-expo`
- `patch-package`
- `typescript`

## 7. 可去依赖优先级建议

### P0：高风险、直接影响主链路

1. 继续降低 YouTube 对 `noembed.com` 的依赖感知，保持默认可关闭。  
2. 持续压缩 `yt-dlp` 在主链路中的使用范围，只保留必要 fallback。  
3. 为抖音 `a_bogus` helper、worker 健康、Cookie、官方详情字段变化补充更早期告警。
4. 为快手与小红书 parser 建立更稳定的样本回归与失败分类。  

### P1：高风险、但更偏运维/稳定性

1. 统一记录外部平台请求失败的分类报表。  
2. 为 `ffmpeg / ffprobe / yt-dlp / chromium / python helper / a_bogus worker` 增加启动期自检。
3. 推进平台 provider 边界隔离，避免外部依赖渗入业务层。  

### P2：中低风险、提升可维护性

1. 抽 Web + Mobile shared API 类型层，减少双端依赖漂移。  
2. 补齐前端与移动端测试基线，至少覆盖关键策略工具与请求拼装。  
3. 若后续长期保留 lint 脚本，补齐 frontend 本地 eslint 依赖，避免验证链断裂。  

## 8. 当前判断

项目目前“第三方依赖最多”的不是 UI 层，而是“视频平台接入层 + 本地媒体工具链”。  

如果后续要继续做开源收口、稳定性治理或合规梳理，优先顺序建议是：

1. 平台接入依赖治理  
2. 本地可执行工具治理  
3. 双端 shared 类型与测试基线  
4. 普通 npm 包的版本治理  
