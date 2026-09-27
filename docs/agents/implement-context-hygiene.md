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

**日期**：2026-08-23（#07 tab 并发与 #09 显式冻结完成后校准）。行号只作定位起点，动手前仍须 grep 验证。

- `%%%FILE_BEGIN%%%` / `%%%FILE_END%%%`：prompt 定义处 `agent-prompts.ts:50,52,60,62,174,176`（requirement_analyst 含两对：工作文档 + 需求分析.md；mvp_prd 一对：prd.md；prototype/ticket_splitter 占位 prompt 不含）；前端解析处 `ChatArea.tsx:85-86,546`（route 不处理 FILE markers）
- `%%%SCOPE_FROZEN%%%`：已降级为历史消息兼容标记；prompt 只禁止 Agent 输出，`chat/route.ts` 与 `ChatArea.tsx` 只剥离显示，**绝不**由它或自然语言改变冻结状态。
- `%%%SCOPE_FREEZE_PROPOSAL%%%`：`agent-prompts.ts` 的 MVP-PRD / prototype 提议处；`freeze-protocol.ts` 定义；`chat/route.ts` 只把本轮 Agent 输出持久化为 `proposed`；`ChatArea.tsx` 剥离 marker 并显示“确认冻结”控件。控件请求的 `freeze: true` 才注入显式文档生成指令。
- 冻结状态机：`Tab` 的 `freeze_status` 为 `idle` / `proposed` / `generating` / `awaiting_write` / `frozen` / `failed`。`chat/route.ts` 完成生成才到 `awaiting_write`，并持久化正式文件名和 marker 正文 SHA-256 摘要；`freeze/route.ts` 的 `complete` 必须以“项目 + 文件名 + 当前完整正文 + 未绑定”原子写入 `ProjectFile.freeze_binding` 后才正式冻结，`files` 的 POST/PATCH/DELETE 以未绑定条件写入，`cancel` 释放中间绑定后回到 `proposed`；`ChatArea.tsx` 复用既有文件确认，拒绝仍不落盘。
- **03 新增工作文档机制**：文件名含「工作文档」即识别（`file-helpers.ts` 的 `isWorkingDocFile`）——写入 API 整文件替换 + 无 changelog 头 + 排除清单段前插入（`files/route.ts`）；ChatArea 静默写入不弹确认框（`ChatArea.tsx` 静默分支）；文件树琥珀色 📝 标记 + 隐藏「加载到 Agent」（`FileTree.tsx`）；不可加载进上下文（`tabs/[id]/files/route.ts` POST 400 + `context-files.ts` 过滤）。route 注入 `tab.display_name` 到 system prompt（`chat/route.ts`，「当前标签页」节），Agent 用它命名工作文档
- **#09 冻结成员**：`mvp_prd` 与 `prototype` 都使用 proposal + 显式控件协议；`ticket_splitter` 仍不参与范围冻结。新增或改动冻结成员时，同步 `freeze-protocol.ts`、prompt、chat route、freeze route、`ChatArea.tsx` 和 `verify-explicit-freeze-protocol.mjs`。
- **03 文件写入与 HTML 快照**：`files/route.ts` 的 Agent 写入必须经过 `file-helpers.ts` 白名单、路径和 3 MiB 校验；`issues/NN-<slug>.md` 与 `issues/vN/NN-<slug>.md` 是受控子路径。HTML marker 由 `ChatArea.tsx` 保存到 `PrototypeSnapshot` 项目资产 API，不进入 `ProjectFile` 文件树或 `context-files.ts` 上下文加载；快照回看走 `/api/projects/[id]/snapshots` 及其版本详情路由。
- **v1.2 #05 消息事实源**：`Message.ts` 的 assistant `status` 为 `generating` / `completed` / `interrupted` / `failed`，可选 `error_message`；`chat/route.ts` 在流开始前创建正式 assistant 消息，`start` / `token` / `done` / `error` SSE 均带 `messageId`，每个 token 条件持久化；`messages/route.ts` GET 序列化状态，PATCH 以该 ID 请求停止并写入 `interrupted`；`generation-control.ts` 仅用于尽快中止同进程上游流，数据库状态仍为跨请求事实源；`ChatArea.tsx` 只渲染/更新正式 ID 消息，不再创建临时 assistant 气泡。
- **v1.2 #06 生成恢复与幂等**：`Message.ts` 的 `request_id` 由 `{ tab_id, request_id }` 部分唯一索引（仅字符串值）约束；`ensureMessageRequestIdIndex()` 在 `chat/route.ts` 写入前完成索引初始化，同名旧稀疏索引会重建为该定义，迁移既有重复值时只移除较晚记录的 `request_id`，不删除消息。候选替换使用 `replacement_target_id` / `replacement_commit_message_id` / `superseded_by_message_id`，只有 completed assistant 写入 `replacement_committed: true` 后 `message-recovery.ts` 才隐藏旧历史并显示编辑后的用户消息；提交冲突则候选转 failed、旧历史继续可见。`messages/route.ts` GET 和 `ChatArea.tsx` 都经该可见性规则读取；刷新时若仍有 generating，前端每 500ms 对账直到终态。失败/中断候选可用新 requestId 重试，流取消由 `ReadableStream.cancel()` 中止同进程上游。
- **v1.2 #07 tab 并发**：`Tab.version` 和 `active_operation_id` 是 tab 事实的并发保护；`TabOperation` 以 `{ tab_id, request_id }` 记录重放结果。`tab-concurrency.ts` 是发送、重生成、编辑、停止、删除、截断、改名和冻结的共同入口：领取时版本 +1 并锁定，完成/失败时再 +1 并释放；冲突固定为 `TAB_CONFLICT_MESSAGE`。SSE、消息历史和 mutation 响应都必须返回实际 `tabVersion`。UUID/MySQL 的 #08 单条删除与截断复用该领取/完成协议；tab 物理删除会清理 `tab_operations`，改用 `tab_deletion_operations` 保留 `{ tab_id, request_id, user_id }` 的已删除重放结果，且必须同关联清理在一个事务内提交。
- **v1.2 #09 热更新读取边界**：Next dev 若复用旧 Mongoose model，新增字段可能不在 document 投影中；`tab-freeze-state.ts` 直接从 `Tab.collection` 读取冻结状态、版本和冻结文档摘要，`freeze-document-binding.ts` 直接在 `ProjectFile` 上维护冻结绑定。冻结路由和 `messages/route.ts` 的重连状态/版本对账必须使用这些持久化事实，不能用缺失字段回退为 0 或滞留在过期 `generating` UI。
- **v1.2 #10 消息文件来源**：新 assistant 的 `Message.file_provenance_version`（任何数值代表已启用）与 `MessageFileWrite` 是来源事实；后者记录 `message_id`、`tab_id`、`project_id`、`project_file_id`、文件名、创建/更新操作、文件版本与完成/写入状态。`files` POST 必须提供并验证来源 assistant 已完成、同 tab Agent 与项目 ownership 后再记录；仅非生产 replay 的基础夹具允许带显式 `x-pm-assistant-test-system-write` 旁路，产品写入不得缺来源。有来源的文件与记录事务优先同写，独立 MongoDB 回退时若记录失败会按实际版本补偿撤销文件。`messages` GET 返回每条 assistant 的 `fileProvenance`。`ChatArea.tsx` 只以精确 write 认定新消息已写入，只有缺少版本标记的历史消息可按文件名兜底。实时消息在 SSE `start` 即写入 `liveMessageIds`，防止 token 阶段的历史扫描提前消费 marker；重生成一致性提示的“更新文件”才可再次进入普通确认框。删除消息/tab/项目时同步清理 `message_file_writes`；`ProjectFile.version` 在 Agent 写入和用户编辑时都原子递增，是写入记录的版本关联。
- **v1.2 #11 ticket 版本交付**：`ticket-sets` API 以项目 ownership 和 ticket_splitter 的已完成 assistant 消息为来源；候选集合必须是连续 `issues/NN-<slug>.md`，内容只允许 `What to build`、`Blocked by`、验收标准等产品契约，拒绝 `Status`/`Implementation`。`replace` 只更新根 `issues/` 完整集合，`save` 自动生成下一个 `issues/vN/` 并保留旧集合；最大 vN 从文件名推导当前版本，不保存 current 标记。版本列表、选择和下载按完整目录操作；每张文件写入同时创建 `MessageFileWrite`，沿用 #10 事务/ownership/3 MiB/白名单边界。`ChatArea.tsx` 对 ticket_splitter 先显示完整候选集合确认，用户明确选择替换或另存后才交付；`TicketSetPanel` 只显示一个完整版本并下载整套 JSON。
- **v1.3 #04 MySQL 成果层**：UUID 项目的 `project_files`、`agent_file_contexts`、`prototype_snapshots`、`message_file_writes` 由 `mysql-project-artifacts.ts` 统一处理；文件写入和 tickets 整套交付都在单个 MySQL 事务中同时写入来源记录，文件删除以外键清理上下文和来源。API 路由只在 UUID ID 时分流，旧 Mongo 路径保留到 #07 收口。MySQL 聊天必须经 `getLoadedContextFiles` 注入上下文，消息 GET 必须返回精确来源 writes；快照独立于 `project_files`，不得进入上下文。
- **v1.41 #04 阶段状态**：`iteration_stage_states` 是每个迭代四环状态的持久事实。`mysql-iteration-workbench.ts` 在创建或打开阶段会话时写 `in_progress`；`stages/[stage]/complete` 只在用户显式请求且本阶段无 `generating` 消息时写 `completed`。这些状态写入与生成预留、停止操作共用迭代行锁；`workbench` GET 返回状态和生成中的会话 ID，`ProductIterationWorkbench.tsx` 据此展示三态、禁用原因与完成/重新打开入口。候选和项目文件不参与状态推断。
- **v1.41 #04 会话消息顺序**：`iteration_session_messages.created_at` 精度为毫秒，随机 UUID 不能表示同毫秒的先后。`mysql-iteration-workbench.ts` 写入时在会话锁内保持消息时间单调递增；读取及生成前快照均以时间、角色（用户先于 Agent）、ID 排序，编辑/重生成的删除范围须与此顺序一致，兼容已有同毫秒消息。
- **v1.41 #06 手动上下文提示词**：新阶段会话保留旧 `AGENT_SYSTEM_PROMPTS` 的文件产出格式，同时由末尾 v1.41 边界覆盖旧的自动继承文件假设；`workbench-context-prompt.ts` 定义阶段职责、目录与已加载正文边界，`mysql-iteration-workbench.ts` 的 `buildMysqlIterationPrompt` 以单条 `project_files` / `iteration_session_context_files` 查询读取同版目录、引用和正文，排除过程文件。新工作台的正文来源和旧版快照尚未接入，目录与提示词均如实显示“未记录 / 不可撤回”；后续成果票写入真实来源时须同时更新这两处和 `verify-v141-manual-context.mjs`。`projects/[id]/files` 的 GET 只返回轻量目录，不查询正文；文件预览只打开正文，不创建会话引用。
