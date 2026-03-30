# UI 设计规范（历史设计参考）

**Last Updated:** 2026-03-20  
**Status:** Archived（本文件为早期 UI 设计基线，不作为当前实现事实）

> 当前页面样式与交互请以实际代码和当前事实文档为准：`README.md`、`docs/plans/2026-03-20-development-status.md`。

## 1. 历史设计基线（保留）

- 主题：浅色、简洁、功能优先
- 主色：`#0ea5e9`
- 页面背景：`#fafafa`
- 文本主色：`#18181b`
- 次文本：`#71717a`

## 2. 平台色（保留）

- 抖音：`#fe2c55`
- B站：`#00a1d6`
- 小红书：`#ff2442`
- 快手：`#ff4906`
- YouTube：`#ff0000`

## 3. 当前已落地交互（2026-03-20）

- Web 通知与下载历史“一键清空”统一使用 `ConfirmDialog`
- Web 登录态二维码改为页面内本地生成，不再依赖第三方二维码服务
- Web 后台默认入口为 `运行看板`
- Web 运行看板已包含：顶部指标带、登录态明细条带、趋势图、平台全链路接口耗时、链路详情抽屉
- Web 字体改为系统字体栈，无运行时 Google Fonts 依赖
- 无封面场景改为本地占位图资源
- iOS 通知页“一键清空”与“全部已读”同排展示
- iOS 下载历史页支持长按多选 / 全选 / 删除选中 / 一键清空

## 4. 响应式口径（保留）

- `mobile`：< 640px
- `tablet`：640-1024px
- `desktop`：> 1024px

## 5. 设计范围边界（当前仍未实现）

1. 支付页面与订单完成页
2. 完整商用级监控大盘与告警配置台
3. 多语言切换

## 6. 当前应参考文档

- `README.md`
- `docs/plans/2026-03-20-development-status.md`
- `docs/plans/2026-03-20-project-architecture-summary.md`
- `docs/plans/2026-03-16-dual-platform-development-checklist.md`
