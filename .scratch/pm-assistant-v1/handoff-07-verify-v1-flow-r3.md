# Handoff R3 — 07 四环全流程验证（已全量通过，转入人工验收）

> 交接日期：2026-08-11。07 全量验证完成，7 个 issues 全部收尾；用户将人工体验 v1 四环，边体验边修发现的问题。
> 新会话入口：`/implement @.scratch/pm-assistant-v1/issues/07-verify-v1-flow.md`（或直接对话——07 已勾选完成，工作模式转为「报问题 → 判定 → 修复」）
> 上一份交接：`.scratch/pm-assistant-v1/handoff-07-verify-v1-flow-r2.md`（六轮调试史，可作背景，勿重读全文）
> 人工验收指南：`.scratch/pm-assistant-v1/acceptance-guide.md`（本次会话产出，验收时对照）

## 一句话现状

**7 个 issues（01-07）全部完成**。verify-v1-flow run7：82✅/0❌/4 WARN；回归 11 脚本全绿（含 verify-401 8/8）；code-review 通过；ticket 07 已勾选+记录。**下一步 = 用户人工体验 v1 四环（对照 acceptance-guide.md），发现问题报给本会话，按「先判断言伪影 vs 真实违约，再动手」模式修复。**

## 项目已经做了什么（7 个 issue 全貌，引用证据勿重读）

| Issue | 交付 | 验证证据 |
|---|---|---|
| 01 verify-protocols | 协议标记（FILE/HTML/SCOPE_FROZEN）验证 | scripts/verify-protocols.mjs |
| 02 agent-type-infrastructure | 四种 Agent 基建：requirement_analyst/mvp_prd/prototype/ticket_splitter，显示名「需求分析/MVP-PRD/原型/任务拆分」 | src/lib/agent-constants.ts、verify-agent-types.mjs |
| 03 requirement-analyst-discipline | 诘问 → 四段（用户与场景/用户故事/功能范围/成功指标）→ 工作文档机制（静默写入/琥珀色/不可加载）→ 排除项附理由 | verify-requirement-analyst-discipline.mjs |
| 04 prototype-agent | 提案式访谈 → HTML 快照下载 → 指正修订 → 完满冻结 → 原型.md（五字段） | verify-prototype-agent.mjs |
| 05 prd-six-section-refactor | 二次确认 → 概念版（≤300 字/七字段/落盘独立文件）→ 范围冻结 → 六章 prd.md（第 3/5 章与原型.md 零转换） | verify-prd-six-section.mjs |
| 06 ticket-splitter-agent | 草案 → quiz 三问 → 批准 → issues/NN-<slug>.md 文件集（四字段/编号拓扑序/引用非复制/逐个确认/无冻结可重切） | verify-ticket-splitter.mjs |
| 07 verify-v1-flow | 四环端到端串联脚本 + 全部断言（结构+数据） | scripts/verify-v1-flow.mjs（run7: 82✅/0❌） |

**关键机制位置**（改协议时同步，勿遗漏）：
- 协议三处耦合点快照：`docs/agents/implement-context-hygiene.md` 末尾「协议三处耦合点现状快照」（agent-prompts.ts / ChatArea.tsx / chat/route.ts 的 marker 位置与执法逻辑）
- 冻结执法泛化：`chat/route.ts` 的 FROZEN_REMINDERS + SCOPE_FREEZE_CONFIRM_RE + 标记校验 strip；肯定词超集（好/行/是/ok/Yes/完满/确认）
- 工作文档/概念版识别：`file-helpers.ts` isWorkingDocFile / isConceptDocFile；不可加载三处（context-files.ts 过滤 + FileTree 隐藏按钮 + files route POST 400）
- issues/ 子路径：写入 API 零改动（(project_id, filename) 唯一索引天然支持）；文件树按首段分组；下载取 basename
- 文件确认队列化：ChatArea.tsx checkAndShowFileDialog 入队 + 队列 effect 逐个弹

## 本会话（07 收尾）新增成果

1. **splitProtoBlocks 白名单分类**（verify-v1-flow.mjs）：独立块按内容标记分类——页面块必有五字段标记（`**目的**|**元素**`）、流程块标题含「用户流程」，其余（排除项/依赖/杂项段）跳过。黑名单三轮变体后换白名单，5 轮历史文件离线验证全绿
2. **verify-prd-six-section 驱动修复**（超出 ticket 字面，回归通过隐含需求，已补记 ticket Comments）：概念版确认消息改「请先把概念版写入独立文件供回看，再冻结范围，然后开始详细撰写」+ 冻结纠正轮。修复前连续 3 次失败（Agent 跳冻结直接写六章），修复后 27/27 稳定
3. **route 180s 超时不变量**：chat/route.ts `timeout: 180_000` 与脚本等待 300s 互指注释（code-review 建议，已补）
4. **ticket 07 收尾**：全清单勾选 + Comments 实施记录（Status 保持 ready-for-agent——01-06 均如此，勾选+记录即惯例）
5. **诊断工具清理**：dump-run5-files.mjs / check-zeroconv.mjs / run2/4/5-files / 旧轮日志已删；保留 runX-files（最终轮产物）、handoff、acceptance-guide

**提交**（master）：`655edde`（白名单+冻结纠正轮）、`7cd9f25`（ticket 收尾+清理）、`8e2aed0/1d4c235`（auto-save，含 run7 日志等）

## 现在大概需要它做什么（新会话工作模式）

**主模式：人工验收陪跑 + 问题修复**
1. 用户按 acceptance-guide.md 体验四环（新账号注册防旧数据干扰；dev server 需自行 `npm run dev` 启动，MongoDB + key 在 .env.local）
2. 用户报问题 → **先判定「脚本断言伪影 vs Agent 真实违约」再动手**（血泪教训：6 轮中 3 轮失败全是脚本分类伪影；离线验证/重跑先于改断言）
3. 修复后跑对应 verify 脚本确认 + 回归相关脚本

**已知偶发/待办（勿重复排查）**：
- 概念版字数偶发超 650 阈值（LLM 措辞超限，格式正常）——**勿放宽阈值**；频繁复现归 05 新 ticket
- verify-ticket-splitter 引用格式首跑偶发缺「见」前缀，重跑即过（未改断言）
- verify-401 前置：改坏 key → **重启 dev server** → 跑 → 恢复 + 重启；注意 TaskStop 只杀 shell，Node 子进程残留占 3000 端口——重启前先 `netstat -ano | grep :3000` 清理
- code-review 遗留判断性标注（均未修，如需可议）：splitProtoBlocks 与离线工具重复（离线工具已删，此条已消解）；magic number 已补注释；纠正轮一次机会不兜底（run7 未触发）

**环境**：dev server 当前**已关闭**（用户验收前自行启动）；工作区干净（dev-server.log 已提交，重启后其改动会出现在 git status，属正常）

## suggested skills

- `verify` — 人工走查四环 UI（验收陪跑）
- `/implement` — 用户报问题后的修复入口（ticket 或直接对话）
- `/code-review` — 修复后必跑
- `/handoff` — 若再近 120k 止损线或新一轮阶段性交接
