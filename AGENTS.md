# AGENTS.md — Agent 会话纪律（dsh 覆盖层）

本文件面向 **dsh（DeepSeek Harness）会话**。Claude Code 会话照常以 `CLAUDE.md` 为准。

## 定位

本仓库完整纪律在 `CLAUDE.md`（自动读取）与 `docs/agents/implement-context-hygiene.md`。本文件**不重复**它们，只做两件事：

1. **开工路径指路**（与 implement-context-hygiene.md 的规则 1-5 一致）；
2. **覆盖 token 阈值**：`implement-context-hygiene.md` 中的 120k/150k 是 Claude Code 200k 窗口的标定，**不适用于 dsh 的 1M 窗口**，以本文件为准。

## 开工路径（每个会话第一步，按序）

| 序 | 读 | 获得 |
|---|---|---|
| 1 | `CLAUDE.md` | 风险分级（L0/L1/L2）与验证策略（自动加载，0 成本） |
| 2 | 本文件 | 阈值覆盖 + 会话纪律 |
| 3 | `PROGRESS.md` | 单点真相：当前阶段 / 本次任务 / 坑（**开始必读，结束必写**） |
| 4 | 当前 ticket（`.scratch/<feature-slug>/issues/NN-<slug>.md`） | 任务定义 + AC + Blocked by |
| 5 | `spec.md` 相关章节 | 需求总纲（目的驱动：ticket 引用到的部分） |

5 之后按需读核心源码与 `scripts/verify-*.mjs` 头尾（风格参考）。铁律：**目的驱动阅读**——读任何文件前先回答「我需要它的什么信息」，详见 implement-context-hygiene.md。

## 会话纪律（dsh 版阈值）

| 项 | Claude Code 旧值 | dsh 采用值 |
|---|---|---|
| 上下文止损线 | 120k | **600k（暂定，首个长会话实测校准）** |
| dumb zone 起点 | 150k | **≈ 700k-750k（估算，实测校准）** |

- **止损触发**：会话 token 计数 ≈600k 时停止当前工作，询问用户是否交接（更新 PROGRESS.md 后开新会话继续）。
- **提前触发信号（无长度依赖，保留）**：连续 2 次「凭猜改代码 → 跑 → 看输出」= 已失去对代码的掌握，停止猜测，先读代码建立真实假设；每次跑真实 LLM 对话前自问「这次验证什么假设」，答不出 = 无意识试错。
- **调试隔离**：验证脚本的调试循环放独立上下文（subagent/子代理），主会话只收最终摘要；中间输出落临时文件，不读进主会话。
- **长验证先报备**：LLM 级验证（`scripts/verify-*.mjs`，真实 DeepSeek 对话 + 真实 UI 驱动）预计超 10 分钟，先告知预计时长和理由，用户同意才跑。
- **被问即汇报**：用户询问进度或怀疑卡住时，主动声明 ①为什么跑了这么久 ②是否必要继续 ③再多久出结果——让用户决定继续或止损，禁止只确认状态后敷衍。

## 项目文件地图

- **实现输入**：`PROGRESS.md`、当前 ticket、`spec.md`、`CONTEXT.md`、`docs/adr/`（ticket 引用到的部分）
- **风格参考**（只读头尾）：`scripts/verify-*.mjs`（命名 `verify-<主题>.mjs`、中文注释、✅/❌ 计数、`process.exit(fail>0?1:0)`）
- **历史文件**（默认不读）：`.scratch/pm-assistant-mvp/`（旧 MVP，已交付）、`.scratch/prd-structure/`、非当前 ticket 的其他 issue——**历史票保持原样，不更新**
- **协议耦合点快照**：`docs/agents/implement-context-hygiene.md` 末尾（行号仅供参考，动手前 grep 验证，勿盲信）

## 会话收尾（必做清单）

1. 更新 `PROGRESS.md`（已完成成果 + frontier 推进 + 新踩的坑）
2. 涉及协议改动的，更新协议耦合点快照
3. `git add -A && git commit`（信息清晰：票号 + 要点）；push 前经用户确认
