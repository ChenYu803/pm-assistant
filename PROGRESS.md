# PROGRESS.md — 项目状态与交接（implement Agent 单点真相）

> 每个 implement 会话：**开始必读，结束必写**。决策见 CONTEXT.md、票状态以
> `.scratch/pm-assistant-v1.1/issues/` 为准——本文件是叙事摘要 + 当前任务指针，
> 不重复上述文档的细节。更新者：会话收尾的 implement Agent / 用户拍板时。

## 当前阶段

**v1.1（使用体验改进）进行中** —— 票 01（体验基础批）、票 02（消息交互）和票 03（Agent 自我说明）已完成，frontier = 04。
v1.0 已验收（2026-08-11），四环流水线端到端走通。

## 已完成成果

- **v1.0（2026-08-11 验收）**：四环流水线（需求分析 → 原型 → PRD → 任务拆分）全链路走通，verify-v1-flow 82 断言全绿；PRD 六章结构、任务拆分 issues 文件集、工作文档/概念版机制落地。
- **v1.1 票 01（2026-08-11 完成）**：体验基础批三块——①文件更新修复（写入判定改「消息是否已写入」，实时新消息总是重新弹确认框更新文件，仅历史重放用文件名兜底；`ChatArea.tsx` 新增 `liveMessageIds` 解决扫描 effect 抢跑时序）；②工作记录命名与创建一步化（创建面板名称输入 + 回车即建、列表行内改名、顶栏点击改名，共用 `InlineNameInput`；POST work-records 支持可选 name）；③流水线空状态引导（`agent-constants` 收敛 `AGENT_TYPE_ICONS`/`PIPELINE_AGENT_TYPES`，空工作记录渲染四步全景、仅需求分析可点、锁定步骤轻提示）。**配套**：13 个 verify 脚本「确认创建」点击机械更新为「创建」按钮。
- **票 01 验证状态**：tsc ✓、eslint 无新增问题 ✓、针对性实测 16/16 ✓、verify-fixes 10/10 ✓；迁移后 ticket01 专项固定回放审计 14/14 ✓（实时同名文件更新、拒绝不落盘、刷新去重、命名、空状态）；verify-v1-flow replay 已执行，70 通过、10 失败、1 WARN，失败包括需求分析排除清单断言，以及现有 PRD replay fixture 与旧断言不一致，未归因于 ticket01。
- **v1.1 规划（2026-08-11）**：grill-with-docs 敲定体验改进 12 项 + 实测 bug（已写入文件无法更新）；spec 与 8 张票已发布。

## 本次任务

**下一张票 04 — 替换式重新输出**（`issues/04-regenerate-reply.md`，需先确认 Blocked by）

**票 02 已完成（2026-08-21）**：消息 hover 复制/删除与确认弹窗、删除 API、停止生成及 partial 持久化、智能滚动、流式期间输入、单弹窗批量文件确认均已落地。固定回放 `verify-message-interactions.mjs` 11/11、`verify-protocols.mjs` 27/27、`verify-fixes.mjs` 10/10；tsc 与本次改动定向 lint 通过。全量 build 因环境无法访问 Google Fonts 未通过。

**票 03 已完成（2026-08-21）**：Agent 结构化说明收敛到 `AGENT_TYPE_METADATA` 单一数据源，选择弹窗展示职责/输入/输出/流水线位置四段说明，标签页空态更新为「现在该说什么？」直白引导。固定回放 `verify-agent-types.mjs` 25/25，tsc 通过；定向 lint 仅保留工作区页面原有的 4 个 `setState-in-effect` 报错。

## 约束与坑（项目特有，实施中踩过的）

- **auto-name 卡死教训（2026-08-11）**：AI 自动命名曾因 LLM 调用挂起卡死对话框 56 分钟——修复 = 20s 显式超时 + 禁重试。后续所有辅助功能不得阻塞主流程（spec 上下文预警红线同源）。
- **verify 超时对**：verify-v1-flow 等待时长（720s）与 chat/route 上游超时（600s）是一对不变量，改一侧必须同步另一侧。
- **marker 协议与确认流**：%%%FILE_BEGIN%%% 等字面量被 verify-protocols 断言；「拒绝写入不落盘」是 v1.0 验收过的语义，任何确认流改动不得破坏。
- **verify 脚本与 UI 文案耦合**：13 个 verify 脚本都驱动真实 UI（点击按钮/填表），改 UI 按钮名或流程前先 `grep scripts/` 查旧元素（票 01 的「确认创建」→「创建」波及全部 13 个脚本）；改完至少跑一个受影响的非 LLM 脚本（如 verify-fixes）冒烟。
- **L2 判定逻辑改动**（如文件更新修复）完成后需跑 verify-v1-flow 回归，确认四环写入协议不受影响。
- **AI 验证成本规则（2026-08-21）**：本地验证默认使用 `AI_MODE=replay` 固定回放，不调用真实模型；只有显式设置 `AI_MODE=live` 才连接 OpenAI。真实模型验证只检查 prompt 理解，不重复承担 UI、marker 和文件写入回归。

## 文档地图

- 决策（为什么）：`CONTEXT.md` / `docs/adr/`
- 规格（做什么）：`.scratch/pm-assistant-v1.1/spec.md`
- 票与状态：`.scratch/pm-assistant-v1.1/issues/`
- 纪律（怎么做 + 协议耦合快照）：`AGENTS.md` / `docs/agents/implement-context-hygiene.md`
