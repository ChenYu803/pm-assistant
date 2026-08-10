# Handoff — 07 四环全流程验证（verify-v1-flow）

> 交接日期：2026-08-10。本会话已达 138k tokens 触发止损交接。
> 新会话入口：`/implement @.scratch/pm-assistant-v1/issues/07-verify-v1-flow.md @.scratch/pm-assistant-v1/handoff-07-verify-v1-flow.md`

## 一句话现状

脚本 `scripts/verify-v1-flow.mjs` 已写完并经两轮调试（subagent 修复 + 人工运行验证），**第 4 环未验证、2 个断言失败待处理**；回归 11 个脚本 10/11 过（verify-401 失败为前置条件未满足，非回归）。开工前先读 `docs/agents/implement-context-hygiene.md`。

## 已完成（引用证据，勿重复通读）

- **脚本**：`scripts/verify-v1-flow.mjs`（已提交 `03503d4`，工作区干净）——四环串联：注册→项目→需求分析→原型→PRD→任务拆分，每环真实对话 + 结构/数据断言；轮数上限 `MAX_ROUNDS = {ra:10, pt:8, prd:10, ts:6}`（用户已确认）；每环断言块末尾有回复快照变量 `raReplies/ptReplies/prdReplies/tsReplies`（供对话纪律统计，勿删）；第四环弹窗处理「确认 1 个 + 拒绝其余」
- **运行日志**：`.scratch/pm-assistant-v1/verify-v1-flow-partial.log`（本轮运行到第 4 环开头被终止，前 3 环结果见下）
- **提交历史**：`6c781bb`(初版) → `03503d4`(subagent 调试修复) → `f941de5`(日志)

## 运行结果摘要（来自 partial 日志）

| 环节 | 结果 |
|---|---|
| 环1 需求分析 | 全绿，除 ❌「工作文档出现在文件树」——RA 驱动强推话术（RA_OPENING 中「无需逐条取舍验证，直接输出」）让 Agent 跳过工作文档环节，直接输出需求分析.md |
| 环2 原型 | 全绿（HTML 快照×2、下载按钮 .html、完满冻结 scope_frozen、原型.md 五字段/changelog 头） |
| 环3 PRD | 全绿，除 ❌「第 3 章 = 原型.md 页面清单段原文」——真实对话中 PRD Agent 改写了 1/6 个页面块，未零转换嵌入 |
| 环4 任务拆分 | 未验证（进程被终止） |
| 已知现象 | 环2「完满」后偶尔需重复 2-3 次才输出原型.md（不 fail，只慢）；环3 概念版检测逻辑（`/外部依赖声明/ && /概念版/`）工作正常 |

## 下一步（按序）

1. **修 2 个 ❌**（决策点见下）→ 重跑 `node scripts/verify-v1-flow.mjs` 全量（约 20-40 分钟；**后台 Bash 跑，跑起来别中途杀进程**）→ 全绿为止
2. **规范跑 verify-401**（前置条件特殊，流程见下）
3. **/code-review** 审查脚本改动（含本次对断言的任何修改）
4. 更新 ticket 07 状态（按 `docs/agents/issue-tracker.md`）+ 提交（Co-Authored-By: Claude Fable 5）

## 决策点（实现时确认，倾向已标）

- **工作文档断言**：倾向改 WARN（理由：工作文档机制由 03 独立脚本 `verify-requirement-analyst-discipline.mjs` 完整验证，flow 脚本重链式走通；ticket 结构断言只要求「功能范围段含排除项」）。备选：调整 RA 驱动让 Agent 走工作文档（风险：10 轮上限内不收敛）
- **第 3 章零转换**：spec 硬性要求零转换（05 契约）。先重跑确认是否偶发；若稳定复现 = PRD prompt 问题，应新开 ticket 归 05 范围，**不在 07 放宽断言**

## 环境

- dev server：`npm run dev`（重开会话需自行启动），localhost:3000；MongoDB + DEEPSEEK_API_KEY 在 `.env.local`
- 幂等：脚本每轮注册新用户（`verify-flow-${Date.now()}@test.local`），可重复跑

## verify-401 规范跑法（前置条件特殊！脚本头有注明）

1. 备份 `.env.local` → 2. 改坏 `DEEPSEEK_API_KEY`（如加前缀 `broken-`）→ 3. **重启 dev server**（Next 启动时加载 env，改文件对运行中进程不生效）→ 4. `node scripts/verify-401.mjs` → 5. 恢复 `.env.local` + 重启 dev server

## 教训（本会话血泪，务必遵守）

- 调试循环放 subagent/后台 Bash 闭环，主会话只收 ✅/❌ 摘要（hygiene 规则 3）；主会话超过 120k 立即交接，别硬撑
- 单次运行 15-40 分钟：跑起来就别中途杀（本次已付过一次沉没成本：杀掉了全绿运行的 subagent）
- 用户已确认预算：轮数 10/8/10/6、回归全部 11 个 `verify-*.mjs`
- 回归已知偶发：`verify-prototype-agent` / `verify-prd-six-section` 首次跑偶有 LLM 输出波动失败，重跑即过

## suggested skills

- `/implement` — 本 ticket 入口（携带本文件路径）
- `/code-review` — 收尾必跑
- `/handoff` — 若再次接近 120k 止损线
- `verify` — 人工过一遍四环 UI 走查（可选）
