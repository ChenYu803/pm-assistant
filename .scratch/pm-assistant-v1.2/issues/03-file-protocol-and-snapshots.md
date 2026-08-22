# 03 — 文件写入协议与 HTML 快照资产

**What to build:** Agent 只能写入允许的根文件、`issues/NN-<slug>.md` 或 `issues/vN/NN-<slug>.md`；中间文件可保存但不可加载，HTML 快照可回看但不进入普通文件树和 Agent 上下文。

**Blocked by:** #02 — 项目边界与文件参数隔离

**Status:** resolved

- [x] 允许的根文件和受控 `issues/` 路径可以写入，非法路径段、扩展名、控制字符和不支持的 Agent 类型被拒绝。
- [x] 单文件内容超过 3 MiB 时写入失败并返回明确提示。
- [x] 中间文件可以存在于项目存储，但不显示为普通文件树入口，且不能加载进 Agent 上下文。
- [x] HTML 快照支持多个项目范围版本，可回看但不出现在普通文件树，也不能被 Agent 加载。
- [x] 正式 Markdown 文件和任务 tickets 的既有确认写入语义不回归。

## 相关 spec

见 v1.2 spec 的“项目隔离与文件 API”“文件写入协议”和“HTML 快照”。
