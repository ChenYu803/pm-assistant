# Handoff R2 — 07 四环全流程验证（verify-v1-flow）

> 交接日期：2026-08-10。本会话 132k+ 触发止损交接（用户确认等 run6 后台完成后交接）。
> 新会话入口：`/implement @.scratch/pm-assistant-v1/issues/07-verify-v1-flow.md @.scratch/pm-assistant-v1/handoff-07-verify-v1-flow-r2.md`
> 上一份交接：`.scratch/pm-assistant-v1/handoff-07-verify-v1-flow.md`（可作背景，勿重读全文）

## 一句话现状

脚本六轮调试（run2→run6）：三类断言缺陷已修（冻结纠正轮 / 排除项断言对齐 03 / splitProtoBlocks 编号+排除项），route 加 180s 上游超时；**run6 收尾 80✅/2❌，两个失败根因均已定位且修复方向已定**；回归 11 脚本、verify-401、code-review、ticket 提交未做。开工前先读 `docs/agents/implement-context-hygiene.md`。

## 已完成（引用证据，勿重复通读）

- **决策（用户已确认）**：环1「工作文档出现在文件树」改 WARN（warn 不计 fail）——`verify-v1-flow.mjs` 环1 断言块
- **环2 冻结纠正轮**：原型.md 已产出但历史无 `%%%SCOPE_FROZEN%%%` 时纠正一轮（重申「完满」+ 要求补全序列）——`verify-v1-flow.mjs:338-355`
- **route 上游超时**：`src/app/api/tabs/[id]/chat/route.ts:149-157`，`openai.chat.completions.create` 加 `timeout: 180_000`（SDK 默认 10 分钟太长；停滞转有界错误 → 错误 SSE 恢复输入框 → 环以重试继续）
- **harness 等待 180s→300s**：`verify-v1-flow.mjs:112-121`（必须 > route 超时，保证错误先到不崩溃）
- **排除项附理由断言对齐 03**（整段扫 `不做|排除…因为|理由|（|—`，鲁棒加粗格式）——`verify-v1-flow.mjs` 环1
- **splitProtoBlocks：normTitle 编号归一化 + 排除项段跳过**（`## 一、页面清单`/`## 排除项（不做）`）——`verify-v1-flow.mjs` splitProtoBlocks 附近。**注意：仍缺「依赖与外部假设」类杂项段处理 = run6 失败根因，见下**
- dev server 本会话重启过（干净），当前运行中 localhost:3000
- **未提交**：工作区含上述全部代码改动（route.ts + verify-v1-flow.mjs）+ `.scratch/pm-assistant-v1/` 下诊断工具（未跟踪）

## 运行结果摘要（6 轮）

| 轮 | 结果 | 失败根因 |
|---|---|---|
| run2 | 81✅ 1❌ | 冻结：Agent 跳过 %%%SCOPE_FROZEN%%% 直接出原型.md（LLM 波动）→ 已修 |
| run3 | 崩溃 | 环2 DeepSeek 流停滞，harness 180s 先崩（route 无超时）→ 已修 |
| run4 | 81✅ 1❌ | 排除项断言捕获被 `**` 加粗污染 → 已修（对齐 03） |
| run5 | 80✅ 2❌ | 零转换×2：`## 一、页面清单` 编号破坏流程分类 → 已修 |
| run6 | 80✅ 2❌ | 见下（概念版 + 分类第三变体） |

**关键结论**：零转换断言在**全部 5 轮**（handoff 轮 + run2/4/5/6）的真实失败均为**脚本分类伪影**，PRD Agent 真实违约一次未发生。离线验证工具已就绪：`.scratch/pm-assistant-v1/check-zeroconv.mjs <runX-files>` + `dump-run5-files.mjs <skip>`（skip=0 最新轮），run2-files/run4-files/run5-files/runX-files 已含各轮文件。

## run6 两个失败（根因已定位，勿重查）

1. **零转换 1 不一致**：run6 原型.md 末尾 `## 依赖与外部假设` 段被误判为页面块（其内容在 prd.md 第 2 章/概念章，不在第 3 章）。分类变体史：`## 排除项（不做）`（handoff 轮，已修）→ 中文编号（run5，已修）→ `## 依赖与外部假设`（run6）。**黑名单打地鼠 → 改为内容标记白名单**（subs=0 独立块分支）：
   ```js
   const nt = normTitle(top.title);
   if (/用户流程/.test(nt)) { /* 流程块 → 第 5 章 */ }
   else if (/\*\*目的\*\*|\*\*元素\*\*/.test(top.text)) { /* 页面块（五字段标记）→ 第 3 章 */ }
   else { continue; /* 排除项/依赖/杂项段不参与校验 */ }
   ```
   subs 分支（容器分类）已鲁棒（run6 的 6 页面+4 流程容器判定正确），不动。改完用 check-zeroconv.mjs 对全部 5 轮文件离线验证。
2. **概念版 692 字**：断言阈值实为 **650**（`verify-v1-flow.mjs:510` `<= 650`；消息文案「核心内容应 ≤300 字」是措辞误导，**勿改阈值**）。run6 超 42 字，内容格式齐全质量正常，纯 LLM 措辞超限。属 05 契约波动（verify-prd-six-section 同为已知偶发）。**建议先重跑确认频率，频繁复现再归 05 新 ticket，不在 07 放宽**（与上份 handoff 决策一致）。

## 下一步（按序）

1. 修 splitProtoBlocks 白名单分类（见上 sketch）→ 重跑 `node scripts/verify-v1-flow.mjs` 全量（20-40 分钟；后台 Bash，**跑起来别中途杀**）→ 全绿为止
2. 回归 11 个 `verify-*.mjs`（已知偶发：verify-prototype-agent / verify-prd-six-section 首跑 LLM 波动，重跑即过）
3. verify-401 规范跑法（下）
4. `/code-review` 审查全部改动（含 route.ts 超时、断言修改）
5. 更新 ticket 07：勾选清单 + `## Comments` 实施记录（**Status 行保持 ready-for-agent**——01-06 均未改 Status，勾选+记录即惯例）；提交（Co-Authored-By: Claude Fable 5）。「数据断言」勾选项各轮已实质全绿（协议标记落库/文件树/changelog 头）
6. 清理 `.scratch/pm-assistant-v1/` 诊断工具（dump-run5-files.mjs / check-zeroconv.mjs / run*-files / verify-v1-flow-run*.log 按需留删）

## verify-401 规范跑法（前置条件特殊！脚本头有注明）

1. 备份 `.env.local` → 2. 改坏 `DEEPSEEK_API_KEY`（加前缀 `broken-`）→ 3. **重启 dev server**（Next 启动时加载 env）→ 4. `node scripts/verify-401.mjs` → 5. 恢复 `.env.local` + 重启 dev server

## 环境

- dev server 运行中（本会话重启过），localhost:3000；MongoDB + DEEPSEEK_API_KEY 在 `.env.local`
- 幂等：脚本每轮注册新用户（`verify-flow-${Date.now()}@test.local`），可重复跑

## 教训（本会话血泪）

- 验证脚本断言失败**先查「断言分类是否鲁棒」，再怀疑 Agent 违约**——6 轮中 3 轮失败全是脚本分类伪影（冻结=真实波动、零转换=全伪影）
- 黑名单式修补（排除项/编号前缀）打地鼠，第三次变体（依赖段）出现即换白名单思路
- 后台跑中途别杀：run3 死于 API 停滞而非人为，但每轮 20-40 分钟 + 真实 token，止损纪律（>120k 交接、等后台完成后收摘要）必须执行

## suggested skills

- `/implement` — 本 ticket 入口（携带本文件路径）
- `/code-review` — 收尾必跑
- `/handoff` — 若再次接近 120k 止损线
- `verify` — 人工过一遍四环 UI 走查（可选）
