# PROGRESS.md — 项目状态与交接（implement Agent 单点真相）

> 每个 implement 会话：**开始必读，结束必写**。决策见 CONTEXT.md、票状态以
> `.scratch/pm-assistant-v1.1/issues/` 为准——本文件是叙事摘要 + 当前任务指针，
> 不重复上述文档的细节。更新者：会话收尾的 implement Agent / 用户拍板时。

## 当前阶段

**v1.2 规格已发布（2026-08-22），#01 Markdown 安全渲染、#02 项目边界隔离和 #03 文件协议/HTML 快照已完成，后续票待实现**；v1.1（使用体验改进）综合 replay 验证已完成 —— 票 01 至票 08 均已完成；真实模型四环回归仅在发布候选或另行批准后安排。
v1.0 已验收（2026-08-11），四环流水线端到端走通。

## 已完成成果

- **v1.0（2026-08-11 验收）**：四环流水线（需求分析 → 原型 → PRD → 任务拆分）全链路走通，verify-v1-flow 82 断言全绿；PRD 六章结构、任务拆分 issues 文件集、工作文档/概念版机制落地。
- **v1.1 票 01（2026-08-11 完成）**：体验基础批三块——①文件更新修复（写入判定改「消息是否已写入」，实时新消息总是重新弹确认框更新文件，仅历史重放用文件名兜底；`ChatArea.tsx` 新增 `liveMessageIds` 解决扫描 effect 抢跑时序）；②工作记录命名与创建一步化（创建面板名称输入 + 回车即建、列表行内改名、顶栏点击改名，共用 `InlineNameInput`；POST work-records 支持可选 name）；③流水线空状态引导（`agent-constants` 收敛 `AGENT_TYPE_ICONS`/`PIPELINE_AGENT_TYPES`，空工作记录渲染四步全景、仅需求分析可点、锁定步骤轻提示）。**配套**：13 个 verify 脚本「确认创建」点击机械更新为「创建」按钮。
- **票 01 验证状态**：tsc ✓、eslint 无新增问题 ✓、针对性实测 16/16 ✓、verify-fixes 10/10 ✓；迁移后 ticket01 专项固定回放审计 14/14 ✓（实时同名文件更新、拒绝不落盘、刷新去重、命名、空状态）；verify-v1-flow replay 已执行，70 通过、10 失败、1 WARN，失败包括需求分析排除清单断言，以及现有 PRD replay fixture 与旧断言不一致，未归因于 ticket01。
- **v1.1 规划（2026-08-11）**：grill-with-docs 敲定体验改进 12 项 + 实测 bug（已写入文件无法更新）；spec 与 8 张票已发布。
- **v1.2 规格（2026-08-22）**：新增 `.scratch/pm-assistant-v1.2/spec.md`，覆盖安全输入、明确冻结、级联删除、消息恢复、并发、项目隔离、文件边界、HTML 快照和 tickets 版本交付；当前仅完成规格，尚未进入实现。
- **v1.2 票 01（2026-08-22）**：`MarkdownRenderer` 对链接协议、属性字符和代码围栏语言名实施安全白名单；HTML/属性注入保持为转义文本，危险链接降级为不可执行文本。新增 `verify-markdown-safety.mjs` replay 专项，8/8 通过；既有 `verify-fixes.mjs` Markdown 回归 10/10，tsc 与 lint 通过。

## 本次任务

**本次任务：v1.2 票 02、票 03 已完成（2026-08-22）**：#02 的文件 API 现在同时校验用户、URL 项目与文件父项目；tab 文件加载/移除和聊天上下文过滤项目 ownership，历史跨项目上下文不会进入公开列表或 Agent 上下文；非法 `fileId` 返回 400 参数错误，合法但不存在返回 404。新增 `scripts/verify-project-boundary.mjs` replay/API 专项，13/13 通过。#03 新增根文件与 issues 路径白名单、控制字符/扩展名/Agent 校验、3 MiB 限制和独立 `PrototypeSnapshot` 多版本资产 API；HTML marker 在原型 UI 完成后自动保存，快照不进入普通文件树或 Agent 上下文。新增 `scripts/verify-file-protocol-snapshots.mjs`，14/14 通过；任务拆分相邻 replay 22/22 通过；tsc、全量 lint 和 diff check 通过，未调用真实模型。下一 frontier 是 v1.2 票 04。v1.1 票 08 的综合固定回放入口仍覆盖 6 个专项、115 条断言（17 + 28 + 25 + 12 + 6 + 27），未调用真实模型；发布候选时若需完整四环 live 回归，仍须先报备验证假设、轮数和 token/API 成本并取得同意。

**构建与 lint 收尾（2026-08-21）**：移除 `next/font/google` 的构建期网络依赖，改用 CSS 系统字体契约并同步 `verify-a11y`；修复全量 lint 的 8 个 error 和 11 个 warning，并将任务拆分验证脚本同步到单弹窗批量确认语义。`npx tsc --noEmit`、`npm run lint`（0 error / 0 warning）、`npm run build` 均通过；消息专项 28/28、a11y 13/13、任务拆分 22/22、综合 v1.1 replay 115/115 全部通过，未调用真实模型。

**票 02 已完成（2026-08-21）**：消息 hover 复制/删除与确认弹窗、删除 API、停止生成及 partial 持久化、智能滚动、流式期间输入、单弹窗批量文件确认均已落地。固定回放 `verify-message-interactions.mjs` 28/28、`verify-protocols.mjs` 27/27、`verify-fixes.mjs` 10/10；tsc 与本次改动定向 lint 通过。全量 build 已在构建与 lint 收尾中通过。

**票 03 已完成（2026-08-21）**：Agent 结构化说明收敛到 `AGENT_TYPE_METADATA` 单一数据源，选择弹窗展示职责/输入/输出/流水线位置四段说明，标签页空态更新为「现在该说什么？」直白引导。固定回放 `verify-agent-types.mjs` 25/25，tsc 通过；定向 lint 仅保留工作区页面原有的 4 个 `setState-in-effect` 报错。
- **票 04 已完成（2026-08-21）**：聊天接口新增带目标消息 id 的重生成模式，服务端只移除最后一条 assistant 并复用既有历史，不新增 user；前端仅在最后一条 AI 回复展示「重新输出」，新回复替换旧回复，连续重生成和停止生成均保持现有流式语义。固定回放 `verify-message-interactions.mjs` 28/28，tsc 通过；定向 lint 仅保留 ChatArea 原有的 React purity 报错。
- **票 06 已完成（2026-08-21）**：聊天输入区显示历史消息和当前草稿的字符数/4 粗估上下文用量，约 24k tokens 起显示接近上限；估算异常静默隐藏，不增加请求或阻塞聊天主流程。固定回放 `verify-context-usage.mjs` 6/6、既有 `verify-fixes.mjs` 10/10，tsc 通过。
- **票 07 已完成（2026-08-21）**：重生成前按“消息 + 文件名”快照旧回复已写入文件，重生成后若新回复缺失旧文件则提示“已写入文件与新回复可能不同步”；“更新文件”复用现有文件确认/POST 写入流程，“保持不变”不触发写入。固定回放 `verify-message-interactions.mjs` 28/28、`verify-fixes.mjs` 10/10、`verify-protocols.mjs` 27/27，tsc 通过。
- **票 05 已完成（2026-08-21）**：用户消息 hover 显示「编辑」，输入区支持回填、取消和「重新发送」；编辑通过消息 API 从目标用户消息起截断后复用既有发送流，服务端回传真实用户消息 id，保证发送后不刷新也可编辑，历史无重复用户消息。固定回放 `verify-edit-resend.mjs` 12/12，tsc 与消息 API 定向 lint 通过。
- **AI 供应商配置（2026-08-21）**：切回 DeepSeek OpenAI 兼容接口，默认模型为 `deepseek-v4-flash`；真实 key 保留在本地 `.env.local`，不进入仓库。

## 约束与坑（项目特有，实施中踩过的）

- **auto-name 卡死教训（2026-08-11）**：AI 自动命名曾因 LLM 调用挂起卡死对话框 56 分钟——修复 = 20s 显式超时 + 禁重试。后续所有辅助功能不得阻塞主流程（spec 上下文预警红线同源）。
- **verify 超时对**：verify-v1-flow 等待时长（720s）与 chat/route 上游超时（600s）是一对不变量，改一侧必须同步另一侧。
- **marker 协议与确认流**：%%%FILE_BEGIN%%% 等字面量被 verify-protocols 断言；「拒绝写入不落盘」是 v1.0 验收过的语义，任何确认流改动不得破坏。
- **verify 脚本与 UI 文案耦合**：13 个 verify 脚本都驱动真实 UI（点击按钮/填表），改 UI 按钮名或流程前先 `grep scripts/` 查旧元素（票 01 的「确认创建」→「创建」波及全部 13 个脚本）；改完至少跑一个受影响的非 LLM 脚本（如 verify-fixes）冒烟。
- **L2 判定逻辑改动**（如文件更新修复）完成后需跑 verify-v1-flow 回归，确认四环写入协议不受影响。
- **AI 验证成本规则（2026-08-21）**：本地验证默认使用 `AI_MODE=replay` 固定回放，不调用真实模型；只有显式设置 `AI_MODE=live` 才连接 OpenAI。真实模型验证只检查 prompt 理解，不重复承担 UI、marker 和文件写入回归。
- **v1.2 #03 验证夹具迁移（2026-08-22）**：文件写入白名单按规格拒绝非正式根文件（如旧消息专项使用的 `legacy.md`），因此 `verify-message-interactions.mjs` 的旧 fixture 会在“旧回复文件已写入”处失败并中断；正式根文件、issues 路径和快照专项已通过，后续若运行综合旧脚本需先迁移 fixture 到白名单文件名。`verify-prototype-agent.mjs` 仍查找已被 v1.1 替换的「确认写入」按钮，失败属于验证脚本文案债务，不是 #03 运行时回归。

## 文档地图

- 决策（为什么）：`CONTEXT.md` / `docs/adr/`
- 规格（做什么）：`.scratch/pm-assistant-v1.1/spec.md`
- 票与状态：`.scratch/pm-assistant-v1.1/issues/`
- 纪律（怎么做 + 协议耦合快照）：`AGENTS.md` / `docs/agents/implement-context-hygiene.md`
