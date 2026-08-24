# 08: 补齐 tab 与消息变更行为

**Parent:** #07 — MySQL 单库收口与综合验收

**What to build:** MySQL 用户可以删除 tab、删除单条消息，以及编辑用户消息后截断其后的历史；这些操作继续遵守 ownership、版本冲突、请求幂等和关联数据清理规则，不再依赖 MongoDB 回退。

**Blocked by:** #03 — 对话、恢复与并发切换；#04 — 项目成果与 tickets 交付切换；#05 — 显式冻结流程切换；#06 — 项目与工作记录级联删除切换

**Status:** implemented-pending-mysql-verification

- [x] 删除 tab 时校验当前用户 ownership，并在一个可回滚的一致性边界内清理消息、文件上下文、消息文件来源和 tab 操作记录。
- [x] 删除单条消息时只删除目标消息及其来源记录，不误删同一 tab 的其他历史；不存在或不属于当前 tab 的消息返回稳定错误。
- [x] 从用户消息开始截断时包含该用户消息及其后全部消息；非用户消息不能作为编辑截断起点。
- [x] 消息自引用、替换链和来源外键不会阻断合法删除，也不会在成功后留下悬空引用。
- [x] 删除消息和截断使用 `expectedVersion + requestId` 契约：过期版本提示冲突，重复请求返回同一结果，不重复增加 tab 版本。
- [x] 删除或截断遇到事务失败时整体回滚，用户可手动重试；运行中的生成不会形成删除后继续写入的残留。
- [x] 增加 MySQL 专项 replay，覆盖 tab 删除、单条消息删除、编辑截断、幂等重放、版本冲突、ownership 和事务回滚的外部结果。

**验证状态（2026-08-24）**：新增 `verify:mysql-tab-message-mutations`，脚本语法、`npx tsc --noEmit`、相关 ESLint 与 `git diff --check` 已通过。专项 replay 未运行：本机 `.env.local` 缺少 `MYSQL_HOST`、`MYSQL_DATABASE`、`MYSQL_USER`、`MYSQL_PASSWORD`，且 Playwright Chromium 不存在。

## 相关 spec

见 v1.3 spec 的“消息、生成与冻结”“一致性、并发与删除”和“行为兼容”。
