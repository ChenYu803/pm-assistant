# 08 — 自动命名条件更新

**What to build:** 工作记录自动命名只在名称仍为“未命名”时生效；用户手动改名或其他请求已先成功时，过期自动命名不会覆盖最新名称。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] 未命名工作记录在首次对话后仍可由 Agent 自动命名。
- [x] 用户在自动命名等待期间手动改名后，自动命名结果不会覆盖用户名称。
- [x] 多个 tab 同时触发自动命名时，只有符合最新条件的更新成功。
- [x] 自动命名失败不影响用户手动改名和正常聊天。
- [x] 条件更新的竞态结果可通过 API 数据和工作区 UI 验证。

## 相关 spec

见 v1.2 spec 的“tab 并发与工作记录命名”和“工作记录命名”。

## 完成记录

- 条件更新以名称仍为“未命名”为前提；多个 tab 的结果只有第一个成功写入。
- 聊天 SSE 完成后由页面发起独立命名请求，命名失败不会拖住聊天，成功后立即同步工作区标题。
- `AI_MODE=replay AUTO_NAME_TEST_HOOKS=1 VERIFY_BASE_URL=http://localhost:3002 node scripts/verify-conditional-auto-naming.mjs`：5/5 通过；`npx tsc --noEmit` 通过。
