# Docs Index

## 当前事实文档（优先阅读）

1. `README.md`
- 项目总览、能力边界、双端约束、接口概览、启动方式。

2. `docs/plans/2026-03-24-development-status.md`
- 当前开发现状主快照，记录“已完成 / 未完成 / 风险 / 本轮新增点”。

3. `docs/plans/2026-03-24-project-architecture-summary.md`
- 当前项目架构、模块分层、双端能力覆盖与主要技术债。

4. `docs/plans/2026-03-24-docker-deployment-guide.md`
- Docker 本地部署与联调口径，包含时区、健康检查、环境变量和重建规则。

5. `docs/plans/2026-03-16-dual-platform-development-checklist.md`
- 双端（Web + App）开发、提测、发布前检查清单。

6. `mobile/README.md`
- 移动端专项能力说明（iOS 优先策略、Runtime 追踪、历史/通知增强、冷启动动画、资源口径）。

7. `docs/plans/2026-03-19-parse-performance-benchmark.md`
- 解析性能实测结果，用于历史性能对比，不作为功能状态判断依据。

8. `docs/plans/2026-03-22-third-party-dependency-audit.md`
- 当前项目第三方依赖审计，按外部平台、本地工具、容器基础设施、顶层依赖分类并给出风险建议。

## 专题设计文档（历史设计参考）

1. `docs/plans/2026-03-15-scheme-b-rbac-notification-design.md`
- RBAC + 后台管理 + 通知中心方案基线，实际实现以当前事实文档为准。

2. `docs/superpowers/specs/2026-03-23-douyin-companion-app-design.md`
- 抖音网页登录态管理从“服务端扫码浏览器”迁移到“本机 Companion App 桥接”的正式设计稿，覆盖 macOS 首发、Chrome only、云服务器可用性与后续 Windows 预留。

3. `docs/superpowers/plans/2026-03-23-douyin-companion-app-implementation.md`
- Companion App 落地实现计划，按后端桥接会话、前端状态机、macOS helper、联调发布拆解为可执行任务。

4. `docs/plans/2026-03-23-douyin-companion-app-runbook.md`
- macOS 管理员安装、启动、allowlist 配置和网页登录态管理使用步骤。

5. `video-downloader-ui/design/User-Flow-Wireframes.md`
6. `video-downloader-ui/design/UI-Design-Spec.md`
7. `video-downloader-ui/design/Component-Design.md`
- 早期 UI 与流程设计稿，仅用于回溯演进。

## 历史归档文档（仅回溯）

1. `docs/plans/2026-03-20-development-status.md`
2. `docs/plans/2026-03-20-project-architecture-summary.md`
3. `docs/plans/2026-03-20-docker-deployment-guide.md`
4. `docs/plans/2026-03-22-development-status.md`
5. `docs/plans/2026-03-22-project-architecture-summary.md`
6. `docs/plans/2026-03-22-docker-deployment-guide.md`
7. `docs/plans/2026-03-23-development-status.md`
8. `docs/plans/2026-03-19-development-status.md`
9. `docs/plans/2026-03-19-docker-deployment-plan.md`
10. `docs/plans/2026-03-18-development-status.md`
11. `docs/plans/2026-03-18-docker-deployment-plan.md`
12. `docs/plans/2026-03-17-development-status.md`
13. `docs/plans/2026-03-17-docker-deployment-plan.md`
14. `docs/plans/2026-03-16-development-status.md`
15. `docs/plans/2026-03-15-development-status.md`
16. `docs/plans/2026-03-14-development-status.md`
17. `docs/plans/2026-03-14-one-week-gap-closure-plan.md`
18. `docs/plans/2026-03-14-one-week-gap-closure-report.md`
19. `docs/plans/2026-03-14-video-downloader-design.md`
20. `docs/plans/2026-03-14-video-downloader-implementation-plan.md`

## 文档维护规则（强制）

1. 功能状态判断只能以“当前事实文档”作为依据。
2. 文档与代码冲突时，以代码为准，并在当日补充或更新当日状态快照。
3. API 契约变更必须同步更新：
- `README.md`
- 当日状态快照
- 双端开发检查清单（如受影响）
4. 任何 Web/Backend 代码变更后，需同步更新 Docker 联调口径并执行容器重建验证。
5. 仅 iOS 端或仅文档改动时，不要求执行 Docker 重建。
6. 状态文档与架构/部署事实文档采用“新增当日快照 + 旧版归档”维护，不覆写历史口径。
7. 涉及外部依赖、第三方域名、二进制路径、公开部署口径的变更，必须同步更新当前事实文档与 Docker 指南。
8. 涉及 iOS 冷启动、列表滚动行为、通知角标同步、预览候选策略等端侧体验链路的变更，必须同步更新当日状态快照与架构摘要，避免后续误判为“仍是旧策略”。

## 历史口径说明

- 历史归档文档中的旧错误码、旧流程、旧页面结构仅用于回溯，不代表当前实现。
- `各平台分享链接.md` 是回归样例清单，不属于功能状态文档；若样例更新，需要单独记录维护日期。
