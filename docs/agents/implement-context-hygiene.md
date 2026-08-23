# Implement Agent 上下文节约守则

**本文件存在的理由**：implement 会话的上下文窗口很珍贵，不应让上下文触碰到150k tokens的dumb zone。一次真实教训：01-verify-protocols 对齐阶段，仅通读一个无关文件全文就浪费约 8-10k tokens。本文档让后续每个 implement Agent 不再犯同样的错。

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
2. **触发行为**：停止当前任务 → 询问用户是否要运行 `/handoff` 技能（把会话压缩为交接文档，存 OS 临时目录，含 suggested skills 段，引用而非复制 spec/issues/commits 等已有产物），给用户“开新会话继续”的建议。
3. **验证脚本调试纪律**（03 教训：调试中间输出留在主会话，把会话推进了 dumb zone。04/05/06 必守）：
   - **执行与调试放在独立上下文**：脚本需调试时用后台 Agent（subagent，自带工具可自迭代脚本），脚本已确定时用后台 Bash；主会话只接收最终摘要（✅/❌ 计数），中间输出落临时文件，不 Read 进主会话
   - 调试循环（改脚本→跑→看输出→猜→再改）在 subagent 自己的上下文里闭环；撑爆了换新 subagent 重来，主会话永远干净
   - tokens 不吝啬，真实对话次数不限；离线/假数据自测保留为 subagent 内部快速反馈手段；单次运行仍设轮数上限控时长（调试期 4 轮冒烟、验证期拉满）
   - 每次新注册用户/项目无妨（测试数据），无需跨次复用会话状态
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

- `%%%FILE_BEGIN%%%` / `%%%FILE_END%%%`：prompt 定义处 `agent-prompts.ts:50,52,60,62,174,176`（requirement_analyst 含两对：工作文档 + 需求分析.md；mvp_prd 一对：prd.md；prototype/ticket_splitter 占位 prompt 不含）；前端解析处 `ChatArea.tsx:85-86,546`（route 不处理 FILE markers）
- `%%%SCOPE_FROZEN%%%`：`agent-prompts.ts:153`；`chat/route.ts:156,168`；`ChatArea.tsx:545`
- 肯定词清单：prompt 处 `agent-prompts.ts:10,104,152`（**最小契约**，requirement_analyst 在 10 行、mvp_prd 在 104/152）；执法处 `chat/route.ts:21` 的 `SCOPE_FREEZE_CONFIRM_RE`（**超集**，多 好/行/是/ok/Yes）；前端不校验肯定词
- **03 新增工作文档机制**：文件名含「工作文档」即识别（`file-helpers.ts` 的 `isWorkingDocFile`）——写入 API 整文件替换 + 无 changelog 头 + 排除清单段前插入（`files/route.ts`）；ChatArea 静默写入不弹确认框（`ChatArea.tsx` 静默分支）；文件树琥珀色 📝 标记 + 隐藏「加载到 Agent」（`FileTree.tsx`）；不可加载进上下文（`tabs/[id]/files/route.ts` POST 400 + `context-files.ts` 过滤）。route 注入 `tab.display_name` 到 system prompt（`chat/route.ts`，「当前标签页」节），Agent 用它命名工作文档
- **02 新增占位 prompt**：`prototype`（`agent-prompts.ts:214-222`）与 `ticket_splitter`（`agent-prompts.ts:223-231`）**不含任何协议标记**——04（原型）/06（任务拆分）落地正式协议时需补 FILE markers / SCOPE_FROZEN / 肯定词，并同步三处；占位期间无冻结执法（chat route 的冻结逻辑仅对 `mvp_prd` 特判，`chat/route.ts:86,154`）
- **03 文件写入与 HTML 快照**：`files/route.ts` 的 Agent 写入必须经过 `file-helpers.ts` 白名单、路径和 3 MiB 校验；`issues/NN-<slug>.md` 与 `issues/vN/NN-<slug>.md` 是受控子路径。HTML marker 由 `ChatArea.tsx` 保存到 `PrototypeSnapshot` 项目资产 API，不进入 `ProjectFile` 文件树或 `context-files.ts` 上下文加载；快照回看走 `/api/projects/[id]/snapshots` 及其版本详情路由。
- **v1.2 #05 消息事实源**：`Message.ts` 的 assistant `status` 为 `generating` / `completed` / `interrupted` / `failed`，可选 `error_message`；`chat/route.ts` 在流开始前创建正式 assistant 消息，`start` / `token` / `done` / `error` SSE 均带 `messageId`，每个 token 条件持久化；`messages/route.ts` GET 序列化状态，PATCH 以该 ID 请求停止并写入 `interrupted`；`generation-control.ts` 仅用于尽快中止同进程上游流，数据库状态仍为跨请求事实源；`ChatArea.tsx` 只渲染/更新正式 ID 消息，不再创建临时 assistant 气泡。
- **v1.2 #06 生成恢复与幂等**：`Message.ts` 的 `request_id` 由 `{ tab_id, request_id }` 部分唯一索引（仅字符串值）约束；`ensureMessageRequestIdIndex()` 在 `chat/route.ts` 写入前完成索引初始化，同名旧稀疏索引会重建为该定义，迁移既有重复值时只移除较晚记录的 `request_id`，不删除消息。候选替换使用 `replacement_target_id` / `replacement_commit_message_id` / `superseded_by_message_id`，只有 completed assistant 写入 `replacement_committed: true` 后 `message-recovery.ts` 才隐藏旧历史并显示编辑后的用户消息；提交冲突则候选转 failed、旧历史继续可见。`messages/route.ts` GET 和 `ChatArea.tsx` 都经该可见性规则读取；刷新时若仍有 generating，前端每 500ms 对账直到终态。失败/中断候选可用新 requestId 重试，流取消由 `ReadableStream.cancel()` 中止同进程上游。
