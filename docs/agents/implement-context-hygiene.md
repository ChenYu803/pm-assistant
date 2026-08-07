# Implement Agent 上下文节约守则

**本文件存在的理由**：implement 会话的上下文窗口很贵。一次真实教训：01-verify-protocols 对齐阶段，仅通读一个无关文件全文就浪费约 8-10k tokens。本文档让后续每个 implement Agent 不再犯同样的错。

**职责**：开始任何 implement 工作前，先读本文档，然后按它的规则规划阅读，再动手。

## 铁律：目的驱动阅读

读任何文件前先回答：**我需要它的什么信息？** 然后按答案选最小读取方式：

| 需要什么 | 怎么读 |
|---|---|
| 只学**风格**（注释语言/命名/输出格式/退出码） | 只读文件头 ~30 行 + 尾部 ~20 行（`Read` 带 `offset`/`limit`，或 `head`/`tail`） |
| 只找**几个点**（协议标记/常量/函数位置） | 精准 grep + `-n` 行号；命中行够了就别读全文 |
| **完整理解**（spec、当前 ticket、CONTEXT.md） | 才读全文 |

## 会话止损线（铁律，来自 03 教训）

**为什么存在**：03（需求分析纪律）是一个「小 ticket」，却烧掉近 200k tokens。两处浪费：① 验证脚本调试循环重复跑了 ~9 次真实 DeepSeek 对话（必要次数只有 2：TDD 红 + 绿）；② 会话后半段（>150k，已入 dumb zone）反复犯低级调试错误（`isVisible()` 瞬时检查漏点确认框、break 正则误匹配工作文档 marker 提前断对话）——「写→跑→看输出→猜」循环在长上下文里效率崩坏，猜错的成本逐轮翻倍。

**规则**：

1. **阈值**：会话 token 计数 ≈120k 时停止当前工作。150k 是 dumb zone 起点，120k 是止损线（留出收尾余量）。
2. **触发行为**：停止当前任务 → 运行 `/handoff` 技能（把会话压缩为交接文档，存 OS 临时目录，含 suggested skills 段，引用而非复制 spec/issues/commits 等已有产物）→ 告知用户开新会话继续。
3. **验证脚本调试纪律**（03 最大浪费来源，04/05/06 必守）：
   - 脚本逻辑（选择器、等待条件、应答选词、断言正则）先**离线/本地假数据自测**跑通，真实 LLM 对话只跑 2 次（TDD 红 1 + 绿 1）
   - 调试期把对话轮数上限压到 4（冒烟即可），验证期才拉满
   - 调试循环复用同一会话状态（不每次注册新用户、新项目）
4. **提前触发信号**（不等计数器）：连续 2 次「凭猜改代码 → 跑 → 看输出」就该止损交接，而不是继续猜。每次验证脚本跑真实对话前自问：这次跑需要真实 LLM 吗？

## 具体规则（来自真实教训）

1. **不要为"学风格"通读既有 verify 脚本全文**。`scripts/verify-fixes.mjs` 297 行中约 250 行是 E2E 驱动逻辑（Playwright/MongoDB 造数据），与静态脚本任务零相关；风格信息（中文注释、✅/❌ 计数输出、`process.exit(fail>0?1:0)`）只出现在头尾 ~30 行。
2. **grep 用符号锚定，不用中文普通词**。搜「确认/可以/同意」会命中大量 prompt 文案噪声（40 行命中里只有 2 行有用）。正确做法：搜常量名（如 `SCOPE_FREEZE_CONFIRM_RE`）、正则原文、或带 `%%%` 的协议标记。
3. **探索按层级推进，每层产出不够才进下一层**：① `ls` 目录拿清单 → ② 精准 grep 拿行号 → ③ 需要时才 `Read` 具体行段。不跳级。
4. **识别并绕开历史文件**：`.scratch/pm-assistant-mvp/`（旧 MVP，已交付）、`.scratch/prd-structure/`（更早方案讨论）、`docs/adr/` 中当前 ticket 未引用的部分，都是背景资料不是实现输入，默认不读。
5. **对齐时用最小证据**：向用户复述任务理解时，grep 命中行 + 文件头部就是够的证据，不需要全文背书。

## 项目文件地图

### 实现输入（值得读）
- `.scratch/<feature-slug>/spec.md` — 需求总纲，唯一必须通读的文档
- `.scratch/<feature-slug>/issues/NN-<slug>.md` — 当前 ticket，唯一必须通读的 ticket（依赖看 `Blocked by:` 行）
- `CONTEXT.md`、`docs/adr/`（当前 ticket 引用到的部分）
- 核心源码：`src/lib/agent-prompts.ts`、`src/app/api/tabs/[id]/chat/route.ts`、`src/components/ChatArea.tsx`

### 风格参考（只读头尾）
- `scripts/verify-*.mjs` — 命名 `verify-<主题>.mjs`、中文注释、✅/❌ 计数、`process.exit(fail>0?1:0)`

### 背景/历史（默认不读）
- `.scratch/pm-assistant-mvp/`、`.scratch/prd-structure/`、非当前 ticket 的其他 issue 文件

## 协议三处耦合点现状快照

**日期**：2026-08-07（03-requirement-analyst-discipline 完成后，行号已随 03 改动校准）。04/06 新增协议时，由对应 implement Agent 更新本快照。

- `%%%FILE_BEGIN%%%` / `%%%FILE_END%%%`：prompt 定义处 `agent-prompts.ts:50,52,60,62,174,176`（requirement_analyst 含两对：工作文档 + 需求分析.md；mvp_prd 一对：prd.md；prototype/ticket_splitter 占位 prompt 不含）；前端解析处 `ChatArea.tsx:85-86,537`（route 不处理 FILE markers）
- `%%%SCOPE_FROZEN%%%`：`agent-prompts.ts:153`；`chat/route.ts:153,158,165`；`ChatArea.tsx:536`
- 肯定词清单：prompt 处 `agent-prompts.ts:10,104,152`（**最小契约**，requirement_analyst 在 10 行、mvp_prd 在 104/152）；执法处 `chat/route.ts:21` 的 `SCOPE_FREEZE_CONFIRM_RE`（**超集**，多 好/行/是/ok/Yes）；前端不校验肯定词
- **03 新增工作文档机制**：文件名含「工作文档」即识别（`file-helpers.ts` 的 `isWorkingDocFile`）——写入 API 整文件替换 + 无 changelog 头 + 排除清单段前插入（`files/route.ts`）；ChatArea 静默写入不弹确认框（`ChatArea.tsx` 静默分支）；文件树琥珀色 📝 标记 + 隐藏「加载到 Agent」（`FileTree.tsx`）；不可加载进上下文（`tabs/[id]/files/route.ts` POST 400 + `context-files.ts` 过滤）。route 注入 `tab.display_name` 到 system prompt（`chat/route.ts`，「当前标签页」节），Agent 用它命名工作文档
- **02 新增占位 prompt**：`prototype`（`agent-prompts.ts:214-222`）与 `ticket_splitter`（`agent-prompts.ts:223-231`）**不含任何协议标记**——04（原型）/06（任务拆分）落地正式协议时需补 FILE markers / SCOPE_FROZEN / 肯定词，并同步三处；占位期间无冻结执法（chat route 的冻结逻辑仅对 `mvp_prd` 特判，`chat/route.ts:83,151`）
