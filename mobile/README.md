# V-SAVE Mobile (Expo)

V-SAVE 移动端 App（iOS 优先，兼容 Android 扩展），技术栈：React Native + Expo Router。

## 当前状态（Last Updated: 2026-03-22）

Mobile v1 主链路可用，当前重点是下载边界稳定性、Runtime 链路追踪精度、通知策略收敛与双端一致性回归。

## 已实现能力（v1）

- 登录 / 注册、SecureStore 自动登录恢复、401 自动失效
- 首页解析：粘贴 / 剪贴板 / 分享扩展 / Deep Link 接入
- 自动解析去重与解析期间禁用态
- 预览与下载：
  - 普通下载：`POST /download/get-url`（携带 `clientType=MOBILE`）
  - YouTube 高画质异步下载：`POST /download/create-task` + 轮询 `GET /download/tasks/:id`
- 历史：列表、单条删除、重新下载、平台/日期筛选、多选批量删除、一键清空
- 通知：列表、单条已读、全部已读、一键清空
- 账户：资料维护、会员状态展示、退出登录
- iOS 底部导航：`expo-router/unstable-native-tabs`

## 下载历史模块（2026-03-20 当前口径）

与 Web 同步能力：
- 平台筛选（抖音 / B站 / 快手 / 小红书 / YouTube）
- 日期筛选（全部、今天、近7天、近30天）
- 一键清空全部历史

iOS 额外能力：
- 长按进入多选模式
- 一键全选
- 删除选中记录（批量删除）
- 非多选模式下支持左滑删除

## 通知模块（2026-03-20 当前口径）

- 通知中心支持分页、下拉刷新、上滑加载更多
- 支持“全部已读”
- 支持“一键清空全部通知”
- 一键清空按钮位于“全部已读”右侧（同一操作行）

通知受众约束（与后端一致）：
- `AUTH_RECOVERED` / `COOKIE_RISK` / `COOKIE_EXPIRED` 为系统内部登录态通知，仅超管账号接收
- 普通用户只接收与本人账号相关通知（会员、账号安全、权益变更等）

## iOS 下载兼容策略（当前实现）

1. B站智能首发：
- 默认候选编码 `codecid !== 7` 时首发 `iosCompatible=true`
- 默认候选编码 `codecid === 7` 时首发普通链路

2. 抖音策略：
- `get-url` 统一携带 `clientType=MOBILE`，默认探测模式由后台模式中心按端侧策略决定
- 抖音解析结果当前直接消费后端官方完整档位，不再以“先单档、后补齐”为主路径
- 每次新解析会话默认选中当前最高画质，同一会话内的手动改档仍会保留
- 首发仅在显式确认前使用 `allowWatermarkFallback=false`
- 若后端返回 `DOUYIN_WATERMARK_FALLBACK_REQUIRED`，弹窗确认后重试 `allowWatermarkFallback=true`
- 若原生下载阶段晚到命中同一错误，端侧会做一次同页重分类与恢复，避免只能返回重解析

3. 相册兼容自动重试：
- 若 iOS 写入相册报不兼容（如 `PHPhotosErrorDomain 3301` / `IOS_PHOTOS_INCOMPATIBLE_CODEC`），下载入口统一走友好提示（顶部 Toast）并自动重试一次 `iosCompatible=true`
- 重试仍失败时保留友好提示，不透出英文系统错误

## Runtime 链路追踪（2026-03-20 当前口径）

- 解析、预览、下载、历史重下流程会生成并透传 `runtimeTraceId`
- 链路标识会通过请求头 `x-runtime-trace-id` 传入下载接口，并在代理请求中附加 `runtimeTraceId/runtimeStage/runtimeClientType`
- 端侧事件上报 `POST /runtime/client-events` 当前支持 `feature=parse|preview|download`，并支持可选 `traceId`
- 历史链路不回填旧数据，链路钻取仅覆盖新流量

## iOS 下载进度显示（2026-03-20）

- 优先显示真实进度：当系统可提供总大小时，按真实字节比例更新下载进度
- 无总大小兜底：当系统无法提供 `Content-Length` 时，启用平滑伪进度
- 伪进度策略：先快后慢逼近上限（约 95%），下载完成后一次性收敛到 100%
- 失败与取消场景：立即停止伪进度计时器，避免残留进度误导用户

## 预览链路现状

- 预览播放器支持候选线路自动切换
- 抖音预览页默认画质取当前质量列表左侧最高档，不再固定钉死在 `1080p`
- 预览失败时展示“可直接下载”提示，不阻断下载操作

## Deep Link / 分享扩展

- Deep Link：`vsave://share?url=<encoded>`
- iOS 分享扩展：`expo-share-intent`
- 重复分享去重：同一链接不会重复触发并发解析

## 图标与品牌资源口径（iOS）

- iOS 运行时图标来源：`mobile/assets/ios-icon-tech-frosted-play.png`
- iOS 冷启动静态图来源：`mobile/assets/ios-splash-tech-frosted-play-transparent.png`
- Android 启动图仍沿用：`mobile/assets/splash-icon.png`
- iOS 与 Web logo 独立维护，不混用素材
- 历史 `mobile/design/` 设计产物已移除，当前仅以 `mobile/assets/*` 为准

## 快速开始

```bash
cd mobile
cp .env.example .env
npm install --legacy-peer-deps
npm run typecheck
```

### 运行（开发客户端）

```bash
npm run prebuild
npm run ios
# 或
npm run android
```

说明：`expo-share-intent` 需要 dev client（`expo run:*` 或 EAS Build），Expo Go 无法完整验证分享扩展。

## 环境变量

- `EXPO_PUBLIC_API_BASE_URL`：后端 API 地址（示例：`http://<LAN-IP>:3001/api`）

联调建议：
- Web Docker：`http://localhost:4871`
- Mobile 真机：`EXPO_PUBLIC_API_BASE_URL` 必须使用主机局域网 IP，不能使用 `localhost`

## 内部分发（EAS）

已提供 `eas.json`，可用 internal distribution profile：

```bash
npx eas build --platform ios --profile preview
```

## 目录结构（核心）

- `app/(auth)`：登录 / 注册
- `app/(tabs)`：首页、历史、通知、账户
- `app/share.tsx`：Deep Link 分享中转
- `app/preview.tsx`：预览与下载流程
- `src/lib`：API、下载、解析、iOS 策略、Runtime 追踪
- `src/store`：认证与分享意图状态
- `src/components`：通用 UI 组件

## 当前未覆盖范围

- 后台持续下载 / 断点续传
- 系统推送（APNs / FCM）
- 支付闭环
- iOS 相册不兼容“先失败后重试成功”场景在 Runtime 看板中仍可能缺失失败态标记
