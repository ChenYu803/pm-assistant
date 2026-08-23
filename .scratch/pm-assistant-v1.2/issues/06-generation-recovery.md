# 06 — 重生成、编辑重发与停止生成恢复

**What to build:** 用户重生成或编辑重发时，系统先生成新结果，成功后才替换旧历史；失败保留旧内容，取消保留已生成部分并标记中断，用户可以安全重试。

**Blocked by:** #05 — 服务端消息事实源

**Status:** resolved — 2026-08-23（`AI_MODE=replay` 专项 20/20 通过）

- [x] 重生成成功后新 assistant 结果替换旧结果，旧结果不会与新结果重复显示。
- [x] 重生成失败时旧 assistant 消息保留，并显示失败状态和可重试入口。
- [x] 编辑用户消息并重新发送失败时，原消息及其后续历史不会被静默丢失。
- [x] 取消生成时保留已产生内容并标记中断；刷新后仍可见。
- [x] 重试使用新的幂等请求，不会重复提交或复制旧消息。

## 相关 spec

见 v1.2 spec 的“生成、重生成与消息恢复”和“先生成后替换”。

## Comments

- 候选 assistant 独立生成，以 `replacement_committed` 作为可见性提交屏障；编辑重发不再预先 DELETE，失败或中断候选以新的 `requestId` 重试。
- `Message.content` 仅对 user/system 必填，正式 assistant 可在零 token 失败时保留空内容；Next.js 16 的流式 Route Handler 不再直接使用 `request.signal` 判定中断，流被取消时才经 `ReadableStream.cancel()` 中止上游。
- `tab_id + request_id` 使用仅匹配字符串的 Mongo 部分唯一索引。部署时若存在同名旧稀疏索引会先重建；若存在旧的重复 requestId，仅移除较晚消息的幂等标识、保留所有消息内容，再建立索引；新请求在创建任何用户消息前等待该索引就绪。
- `scripts/verify-message-recovery.mjs` 覆盖正式 ID、刷新恢复、零 token 失败、partial 中断、重生成/编辑替换失败与成功、连续重试、重放及并发幂等。已通过：`AI_MODE=replay node scripts/verify-message-recovery.mjs`（20/20）、`npx tsc --noEmit`、`git diff --check`；未调用真实模型。
