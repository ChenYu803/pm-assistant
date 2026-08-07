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

**日期**：2026-08-07（02-agent-type-infrastructure 完成后，行号已随 02 改动校准）。03/05 重构、04/06 新增协议时，由对应 implement Agent 更新本快照。

- `%%%FILE_BEGIN%%%` / `%%%FILE_END%%%`：prompt 定义处 `agent-prompts.ts:46,48,151,153`（仅 requirement_analyst 与 mvp_prd 两个**正式** prompt 含）；前端解析处 `ChatArea.tsx:85,509`（route 不处理 FILE markers）
- `%%%SCOPE_FROZEN%%%`：`agent-prompts.ts:130`；`chat/route.ts:149,154,161`；`ChatArea.tsx:508`
- 肯定词清单：prompt 处 `agent-prompts.ts:81,129`（**最小契约**）；执法处 `chat/route.ts:21` 的 `SCOPE_FREEZE_CONFIRM_RE`（**超集**，多 好/行/是/ok/Yes）；前端不校验肯定词
- **02 新增占位 prompt**：`prototype`（`agent-prompts.ts:191-198`）与 `ticket_splitter`（`agent-prompts.ts:200-207`）**不含任何协议标记**——04（原型）/06（任务拆分）落地正式协议时需补 FILE markers / SCOPE_FROZEN / 肯定词，并同步三处；占位期间无冻结执法（chat route 的冻结逻辑仅对 `mvp_prd` 特判，`chat/route.ts:79,147`）
