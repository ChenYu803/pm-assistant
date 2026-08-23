# 05 — 服务端消息事实源

**What to build:** 每次生成从服务端预创建唯一的 assistant 消息开始，用户能看到生成中、完成、中断和失败状态；刷新或重连后仍只展示这条正式消息。

**Blocked by:** None (can start immediately)

**Status:** resolved — 2026-08-23（类型检查与非模型结构检查通过；与 #06 的统一 replay 验证待其完成后执行）

- [x] 生成开始时服务端创建 assistant 消息并向客户端返回正式消息 ID。
- [x] 消息状态至少能区分生成中、完成、中断和失败，并在历史查询中保持一致。
- [x] 一个 token 都没有生成就失败时，仍保留失败状态的空 assistant 消息。
- [x] 停止生成保存的 partial 内容挂在正式服务端消息上，不再依赖没有服务端 ID 的临时事实源。
- [x] 刷新或重连后不会因流式回调和历史消息重复展示同一条 assistant 消息。

## Comments

- 生成开始前预创建 `generating` 状态的 assistant 消息；`start`、`token`、`done`、`error` SSE 事件均携带同一正式消息 ID。
- 每个 token 先条件持久化到该消息，再发送 SSE；停止请求把同一消息改为 `interrupted` 并中止上游流。失败（含零 token）把预创建消息改为 `failed`，不删除空消息。
- 已通过 `npx tsc --noEmit`、受影响模块 ESLint 与 `git diff --check`；#05/#06 外部行为 replay 将在 #06 完成后合并执行。

## 相关 spec

见 v1.2 spec 的“生成、重生成与消息恢复”和“消息状态事实源”。
