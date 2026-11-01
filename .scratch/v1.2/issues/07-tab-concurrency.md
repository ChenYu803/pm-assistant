# 07 — tab 并发与幂等操作

**What to build:** 多窗口或网络重复请求修改同一个 tab 时，系统不会静默覆盖成果；重复请求得到幂等结果，版本冲突时用户看到明确提示并手动决定。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] 需要改变 tab 事实的请求使用版本号检查，过期版本不会覆盖最新状态。
- [x] 网络重试或重复点击使用幂等键，不会重复发送、写入或推进同一操作。
- [x] 发生版本冲突时产品提示“此标签页正在被其他窗口修改”。
- [x] 冲突不会自动合并或静默选择某一窗口结果，用户可以手动决定后续操作。
- [x] 发送、重生成、编辑截断、删除消息和冻结状态更新的并发结果可由 API 和 UI 外部行为验证。

## 相关 spec

见 v1.2 spec 的“tab 并发与工作记录命名”和“tab 并发”。

## Comments

- tab 现在持有显式版本和进行中操作标识；服务端用版本检查、持久化 requestId 操作记录和 SSE 终态释放锁，冲突统一返回“此标签页正在被其他窗口修改”。
- 聊天发送、重生成、编辑重发、停止、单条删除、编辑截断与标签页改名接入同一并发契约；冻结可直接复用该服务，未在本票提前加入冻结交互。
- 验证：`AI_MODE=replay node scripts/verify-tab-concurrency.mjs` 16/16；`npx tsc --noEmit`；`node --check scripts/verify-tab-concurrency.mjs`。未调用 `AI_MODE=live`。
