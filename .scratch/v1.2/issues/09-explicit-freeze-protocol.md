# 09 — 显式范围冻结协议

**What to build:** Agent 提议冻结后，用户通过明确控件完成“冻结处理中 → 文档生成 → 写入确认后正式冻结”的两阶段流程；自然语言和历史消息不再触发冻结。

**Blocked by:** #03 — 文件写入协议与 HTML 快照资产；#07 — tab 并发与幂等操作

**Status:** resolved

- [x] Agent 提议冻结时显示明确的确认控件，普通聊天文字、肯定词、否定句和历史消息不会触发冻结。
- [x] 用户确认后进入“冻结处理中”，重复点击不会重复生成或重复写入。
- [x] 文档生成完成后再次显示文件写入确认，写入确认前不成为正式冻结。
- [x] 用户取消或文档生成失败时不正式冻结，并可安全重试。
- [x] 刷新或重连后冻结处理中、失败和正式冻结状态保持一致。

## 相关 spec

见 v1.2 spec 的“范围冻结与明确确认”和“冻结协议”。

## Comments

- 冻结状态机持久化为 `idle → proposed → generating → awaiting_write → frozen`，生成失败进入 `failed`；取消回到 `proposed`。只有 `freeze: true` 的控件请求能生成文档；本轮 marker 正文的 SHA-256 摘要会与确认写入的项目文件比对，只有内容匹配的写入成功后才能正式冻结。完成冻结时以“项目 + 文件名 + 当前完整正文 + 未绑定”原子写入项目文件的冻结绑定，正式冻结后 POST、PATCH、DELETE 都不能覆盖或删除该文件。
- #07 的 `expectedVersion + requestId` 契约覆盖生成、取消和正式冻结；重复请求重放同一结果，过期版本返回明确冲突。消息历史从服务端对账 tab 版本及完整冻结状态，处理中刷新后会恢复到 `awaiting_write` 和文件确认，而不会停留在过期 UI 状态。
- 验证：`AI_MODE=replay node scripts/verify-explicit-freeze-protocol.mjs` 19/19（先确认服务端 replay，含处理中刷新恢复、同名错误正文后的刷新可重试确认、正式冻结后的 POST/PATCH/DELETE 文件锁定和完成/覆盖竞争）；相邻 `verify-message-recovery.mjs` 20/20、`verify-tab-concurrency.mjs` 16/16、`verify-file-protocol-snapshots.mjs` 14/14、`verify-protocols.mjs` 22/22；`npx tsc --noEmit`、脚本语法与 `git diff --check` 通过。未调用 `AI_MODE=live`。
