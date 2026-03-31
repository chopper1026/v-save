# 快手二维码登录与纯 HTTP 解析设计

## 目标

- 为快手增加官方二维码登录能力，登录态由后台统一保存和维护。
- 将快手解析从 `puppeteer-core + chromium` 改为纯 HTTP 请求，去掉后端镜像里的 Chromium 硬依赖。
- 登录态获取优先级固定为：
  - 快手官方二维码登录
  - 手动维护 Cookie 仅保留为应急兜底，不在主流程中强调

## 现状

- 当前快手解析器通过浏览器上下文访问 `visionVideoDetail`，关键入口在 `backend/src/parsers/kuaishou.parser.ts`。
- 这条链路要求运行时存在 Chromium，导致镜像体积偏大，且大陆服务器部署更脆弱。
- 管理后台目前只接入了 B 站二维码登录和抖音桥接登录，未提供快手登录态维护入口。

## 约束

- 本轮不接入 companion 快手桥接流程。
- 若后续用户反馈二维码不稳定、登录后仍出现验证码或强校验，再追加 companion 方案。
- 保持现有下载质量映射、缓存、节流、风控冷却等解析器能力不回退。

## 方案对比

### 方案 A：继续依赖 Chromium

- 优点：复用现有逻辑，改动最少。
- 缺点：镜像体积大，部署脆弱，不符合本轮目标。

### 方案 B：纯 HTTP + 官方二维码登录

- 优点：满足去 Chromium 目标，部署更轻，登录链路与 B 站一致，后台体验统一。
- 缺点：需要补一套快手 auth 模块，并处理二维码轮询状态和 Cookie 入库。

### 方案 C：直接上 companion

- 优点：能复用本机浏览器环境，理论上更接近真实用户登录上下文。
- 缺点：增加用户安装和维护成本，不符合“二维码优先”的已确认决策。

## 采用方案

采用方案 B。

- 认证层新增 `KuaishouAuthModule`、`KuaishouAuthService`、`KuaishouAuthController`。
- 解析层保留 `KuaishouParser` 外部接口不变，仅替换“获取详情”的内部实现。
- 后台登录态管理新增快手面板，交互和 B 站二维码面板保持一致。
- 健康检查与运行时面板扩展到 `kuaishou` 平台。

## 认证流

### 生成二维码

- 后端调用 `https://id.kuaishou.com/rest/c/infra/ks/qr/start`
- 请求体固定带：
  - `sid=kuaishou.server.webday7`
  - `channelType=UNKNOWN`
  - `isWebSig4=true`
- 返回内容中保存：
  - `qrLoginToken`
  - `qrLoginSignature`
  - `qrUrl`
  - `imageData`
  - `expireTime`

### 轮询状态

- 前端轮询后台接口，后台调用 `https://id.kuaishou.com/rest/c/infra/ks/qr/scanResult`
- 轮询语义统一映射为：
  - `pending`
  - `scanned`
  - `confirmed`
  - `expired`
  - `failed`
- 前端只在上一个轮询请求返回后再发下一次，避免与快手长轮询叠加。

### 保存登录态

- `confirmed` 时优先从响应头 `set-cookie` 或响应体跳转参数中提取 Cookie。
- 仅当 Cookie 满足快手网页解析所需关键字段时才入库。
- 数据库存储方式与 B 站、抖音保持一致，来源标记为 `database`。

### 手动 Cookie 兜底

- 保留后台手动保存 Cookie 接口。
- UI 上放到低优先级兜底区块，不与主按钮并列。

## 解析流

### 主路径

- 先规范化分享文本，展开短链，提取 `photoId`。
- 从 `KuaishouAuthService` 获取 Cookie。
- 直接以 HTTP 调用 `https://www.kuaishou.com/graphql` 的 `visionVideoDetail`。
- 请求头包含：
  - `Cookie`
  - `User-Agent`
  - `Referer: https://www.kuaishou.com/`
  - `Origin: https://www.kuaishou.com`

### 兜底路径

- 若 GraphQL 返回空详情但页面可访问，则请求详情页 HTML。
- 从页面中的 `__APOLLO_STATE__` 提取 `VisionVideoDetailPhoto:{id}` 数据。

### 保留能力

- 解析成功缓存
- 串行节流
- 风控冷却
- 画质映射
- 下载线路测速

## 健康检查

- `auth-health` 新增 `kuaishou` 平台。
- 定时检查只做轻量判断：
  - 是否存在 Cookie
  - Cookie 是否包含快手关键字段
- 更强的有效性判断交给真实解析结果上报：
  - 解析成功则标记 `healthy`
  - 明显登录态失效或风控则标记 `degraded` / `invalid`

## 前端

- `AdminAuthManagement` 新增快手状态卡与健康状态。
- 新增 `KuaishouAuthPanel`，结构尽量贴近 `BilibiliAuthPanel`。
- 二维码展示复用现有 `AuthQrCodeCard`。
- 默认主按钮为“扫码登录快手”。
- 手动 Cookie 输入折叠展示，只作兜底。

## 部署与镜像

- 删除后端运行时对 Chromium 的安装与环境变量依赖。
- 删除 compose 和 deploy 中对 `PUPPETEER_EXECUTABLE_PATH` / `KUAISHOU_CHROME_PATH` 的默认注入。
- 更新 Dockerfile 与脚本测试，确保快手不再阻塞去 Chromium。

## 风险

- 快手二维码轮询接口可能是长轮询，后台超时和前端轮询间隔需要保守设置。
- 快手 Cookie 关键字段可能会变化，因此需要把字段校验写成集中式 helper。
- GraphQL 结构可能变化，所以必须保留 HTML + `__APOLLO_STATE__` 兜底。

## 验证标准

- 后台能生成并展示快手二维码。
- 模拟确认登录后，快手 Cookie 能入库并在状态页显示为已配置。
- 快手解析器在无 Chromium 环境下仍可解析受支持视频。
- 后端镜像构建通过，且不再安装 Chromium。
