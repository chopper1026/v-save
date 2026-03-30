# V-SAVE 设计文档（Archived）

**Original Date:** 2026-03-14  
**Archive Updated:** 2026-03-15  
**Status:** 历史设计归档（不作为当前实现依据）

## 1. 归档说明

本文件记录的是 2026-03-14 的阶段性设计稿，后续已发生多轮架构演进，尤其是：

1. 后台管理已统一为 `/admin?tab=users|audit|auth`
2. 登录态管理已迁移到后台（仅超级管理员）
3. 用户管理与角色分配已合并
4. 通知中心、审计细节与状态治理已补齐

因此本文件仅用于回溯设计演进，不用于当前开发决策。

## 2. 当前应参考文档

1. `README.md`
2. `docs/plans/2026-03-22-development-status.md`
3. `docs/plans/2026-03-15-scheme-b-rbac-notification-design.md`
4. `docs/plans/README.md`

## 3. 保留价值

1. 可用于回看初期产品目标与视觉基线
2. 可用于比对“初版方案”与“当前落地”差异

## 4. 注意事项

若发现本文件与代码行为不一致，以当前实现与 2026-03-18 状态文档为准。
