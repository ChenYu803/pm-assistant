# 11 — 任务拆分 tickets 版本交付

**What to build:** 任务拆分 Agent 重新切分时先生成新结果，由用户选择替换当前 tickets 或另存为 `issues/vN/`；旧版本保留，编号最大的版本自动视为当前版本，整套 tickets 不会混用。

**Blocked by:** #03 — 文件写入协议与 HTML 快照资产

**Status:** resolved — ticket 字段契约、候选集合交付、整套版本选择/下载与 replay 验证已完成（2026-08-24）

- [x] 任务拆分 Agent 输出的产品 tickets 包含用户视角交付行为、`Blocked by`、验收标准和必要 PRD 引用，不包含 `Status` 或 `Implementation`。
- [x] 已有 tickets 时重新切分先生成新结果，不直接覆盖旧交付物。
- [x] 用户选择替换时，当前 tickets 作为完整集合更新，不留下新旧文件混合状态。
- [x] 用户选择另存时，新集合写入 `issues/vN/`，旧版本完整保留。
- [x] 编号最大的 `issues/vN/` 自动视为当前版本，下载和选择操作以完整版本目录为单位。

## 相关 spec

见 v1.2 spec 的“任务拆分交付与版本”和“任务重新切分”。
