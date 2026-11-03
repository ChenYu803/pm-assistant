# Implement Agent 上下文节约守则

**本文件存在的理由**：implement 会话的上下文窗口很珍贵，不应让上下文触碰到150k tokens的dumb zone。一次真实教训：01-verify-protocols 对齐阶段，仅通读一个无关文件全文就浪费约 8-10k tokens。本文档让后续每个 implement Agent 不再犯同样的错。

**职责**：开始任何 implement 工作前，先读本文档，然后按它的规则规划阅读，再动手。

## 铁律：目的驱动阅读

读任何文件前先回答：**我需要它的什么信息？** 然后按答案选最小读取方式：

| 需要什么 | 怎么读 |
|---|---|
| 只学**风格**（注释语言/命名/输出格式/退出码） | 只读文件头 ~30 行 + 尾部 ~20 行（`Read` 带 `offset`/`limit`，或 `head`/`tail`） |
| 只找**几个点**（协议标记/常量/函数位置） | 精准 grep + `-n` 行号；命中行够了就别读全文 |
| **完整理解**（spec、当前 ticket、GLOSSARY.md） | 才读全文 |

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
- `.scratch/<版本号>/spec.md` — 需求总纲，唯一必须通读的文档
- `.scratch/<版本号>/issues/NN-<slug>.md` — 当前 ticket，唯一必须通读的 ticket（依赖看 `Blocked by:` 行）
- `GLOSSARY.md`、`docs/adr/`（当前 ticket 引用到的部分）
- 核心源码：`src/lib/agent-prompts.ts`、`src/app/api/tabs/[id]/chat/route.ts`、`src/components/ChatArea.tsx`

### 风格参考（只读头尾）
- `scripts/verify-*.mjs` — 命名 `verify-<主题>.mjs`、中文注释、✅/❌ 计数、`process.exit(fail>0?1:0)`

### 背景/历史（默认不读）
- `.scratch/pm-assistant-mvp/`、`.scratch/prd-structure/`、非当前 ticket 的其他 issue 文件

## 协议三处耦合点现状快照

- **v1.44 #01 本地会话命名**：`mysql-iteration-workbench.ts` 在首条用户消息落库事务中按 `Intl.Segmenter` 的前 10 个字素簇命名，正文和默认名保留原文空格与标点；已有用户消息、已有名称或 `title_manually_set` 均阻止默认命名。回复完成只更新时间。`0023_v144_session_manual_title` 追加人工标记，迁移不回填或修改历史名称；会话 PATCH 在 ownership 事务中同时写名称和标记，允许生成期间人工改名。`ProductIterationWorkbench.tsx` 提供原位改名并防止早发出的名称刷新覆盖刚保存的人工结果。旧 `auto-name`、验证后门、ChatArea 后台触发及专用服务均已撤除，旧命令转到本地命名专项。变更命名、消息正文保存或名称刷新时运行 `verify-v144-local-session-naming.mjs`，并回归 generation-stream 与基础回放；供应商替身只允许隔离库和本机 HTTP，不代表真实供应商或生产证据。

- **v1.42 #02 生产准备**：`launch-policy.ts` 统一注册邀请策略，生产默认 invite、开发默认 open；注册 server page 只向客户端传是否需要邀请码，注册 API 必须在写用户前检查共享码。`ai.ts` 仅显式 live 调用供应商，聊天/编辑/重生成/润色传入 userId，经 `mysql-ai-budget.ts` 在事务内按站点→账号锁占用北京时间日额度；SDK 禁止隐式重试，失败/停止不退还次数，replay 不计。`0022_v142_ai_daily_usage` 属于追加迁移，不修改历史 checksum。旧 `mysql-chat.ts` 使用原 data/type SSE 协议增加 15 秒 heartbeat、禁缓存/转换、断线中止；润色以 Accept 选择 result/heartbeat SSE，`generation-result-client.ts` 拒绝缺终态并保留旧 JSON，结果只预览/应用至草稿、不隐式保存文件。systemd 停旧实例后用 `production-check.ts --database --recover` 校验迁移并在事务内收口遗留生成和旧操作锁，禁止多实例在线恢复。变更须回归 `verify-v142-production-preparation.mjs`、`verify-v142-production-tools.mjs` 及 generation-stream；构建与隔离 Next 副本顺序执行。`production-backup.ts` 的 ISB1/AES-GCM 包仅含 SQL/runtime.env/metadata/source.tar，latest 原子提交；Windows 拉取严格校验索引/SHA/时效，恢复随机新库，extract 拒绝覆盖目录。目标机 nginx/systemd/Cloudflare、真实模型和实际异地拉取仍按部署发布闸单独验收。

- **v1.42 #01 新工作台流式生成**：发送、重新生成与消息 PATCH 编辑使用 `Accept: text/event-stream` 选择 SSE；不携带该头的 JSON 调用保持原状态码和结构。`iteration-generation-stream.ts` 每 15 秒发送 `heartbeat`，正文使用 `token {content,messageId}`，终态使用 `result {status,body}`（流已开始后业务状态放在事件中）；响应禁止缓存/转换并设置 `X-Accel-Buffering: no`。取消响应或请求中止向生成控制器传递 AbortSignal，预先中止的信号也必须识别。`mysql-iteration-workbench.ts` 每 500ms 串行保存部分正文且仍标记 generating；完整回复、候选和原型快照仍只在原有成功事务中提交。普通发送停止/断线保留 failed 部分正文；编辑/重生成失败或取消清理临时回复、保留旧成功事实。前端以真实消息 ID 和累计正文合并切换会话后的恢复，正在本页接收流时不以轮询覆盖实时内容；其他页面/刷新后以数据库轮询恢复，并在生成状态结束时对账终态。改动须回归 `verify-v142-generation-stream.mjs` 与生命周期脚本；涉及正式候选或快照事务时再回归对应 v1.41 专项。应用侧 replay 不证明 nginx/Cloudflare 端到端转发，部署时仍须验收真实长请求。基础回放 `verify-v141-replay-foundation-scenario.mjs` 通过 `verify-foundation-stream-observer.mjs` 旁路读取浏览器 SSE 副本，正常/停止分别断言 `result.status=200/409`，并核对 UI 与持久结果；修改该观察器须运行 `verify-foundation-stream-observer-contract.mjs` 的协议反例检查。

- **v1.41 #17 产品迭代删除**：`deleteMysqlProductIteration` 按项目 → 迭代 → 全部阶段会话使用 `FOR UPDATE NOWAIT`，生成检查必须使用当前读；`iterations/[id]` DELETE 的 `generating` / `writing` 对应 409，阻止和失败不得清理候选或显示成功。同事务先显式删除本轮消息及其候选，再删除迭代父行级联其他过程，避免本机多级级联实测的消息残留；保留项目文件/唯一旧版、任务文件夹/唯一旧集合、HTML 快照和项目级来源。任务归属和文件来源通过迭代是否存续显示只读归档/已删除占位。`projects.next_iteration_number > 1` 是不可回退的迭代使用事实，旧文件写入、整套任务、HTML 保存和旧上下文入口必须在项目锁内拒绝绕过，不能以当前迭代列表为空恢复旧权限。`IterationDeleteDialog.tsx` 只在提交成功后清理本轮会话选择并刷新文件目录，项目文件视图提供只读 Markdown 与全部 HTML 快照浏览。变更须回归 `verify-v141-iteration-deletion.mjs`、会话删除、生命周期、来源、任务归属/整套提交/撤回、手动上下文和快照专项。

- **v1.41 项目删除清理**：`deleteMysqlProjectCascade` 在项目锁内先锁定全部产品迭代，显式清理新工作台消息并删除迭代，再清理旧 tabs、项目文件、HTML 和项目父行；避免多级级联的消息残留。全部步骤同事务，故障回滚须同时恢复新工作台过程和项目级资产；回归项目级联与迭代删除专项。

- **v1.41 #16 阶段会话删除**：`deleteMysqlIterationSession` 按项目 → 迭代 → 会话顺序使用 `FOR UPDATE NOWAIT`，与成果确认/生成事务互斥；锁占用返回 `writing`，生成消息返回 `generating`，删除 API 对应 409 与等待/停止动作。外键只级联清理会话消息、上下文和 Markdown/任务集合候选，保留 `project_files`、`previous_content`、任务文件夹 `previous_snapshot`、HTML 快照和 `project_file_changes`。`mysql-file-history.ts` 用保留的 `session_id` 计算 `sessionDeleted`，来源名称仍取写入时快照；`ProductIterationWorkbench.tsx` 清理被删会话草稿/选择，`SessionDeleteDialog.tsx` 负责危险确认。更改删除或保留边界须回归 `verify-v141-session-deletion.mjs`、迭代生命周期、阶段状态、文件历史与候选/整套交付脚本。

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
- **v1.41 #06 手动上下文提示词**：新阶段会话保留旧 `AGENT_SYSTEM_PROMPTS` 的文件产出格式，同时由末尾 v1.41 边界覆盖旧的自动继承文件假设；`workbench-context-prompt.ts` 定义阶段职责、目录与已加载正文边界，`mysql-iteration-workbench.ts` 的 `buildMysqlIterationPrompt` 以单条 `project_files` / `iteration_session_context_files` 查询读取同版目录、引用和正文，排除过程文件。新工作台的正文来源和旧版快照尚未接入，目录与提示词均如实显示“未记录 / 不可撤回”；后续成果票写入真实来源时须同时更新这两处和 `verify-v141-manual-context.mjs`。`projects/[id]/files` 的 GET 只返回轻量目录，不查询正文；文件预览只打开正文，不创建会话引用。产品验收后，正式界面只在项目文件树提供加入动作，当前上下文只列已加入文件并可移除；文件树、当前上下文和预览不展示内部修订号，Agent 提示词仍携带同版修订元数据。
- **v1.41 #07 首条候选写入**：`mysql-iteration-candidates.ts` 只从需求分析阶段已完成消息的单个正式 `%%%FILE_BEGIN%%%` / `%%%FILE_END%%%` 块建立候选，工作文档不入项目树；候选状态在 `iteration_file_candidates` 随消息/会话保存和删除。`candidates/[candidateId]` POST 由服务端核验迭代、会话、阶段、文件名前缀与预期创建/覆盖操作；`project_files` 正文、唯一 `previous_content`、递增 `version`、`project_file_changes` 来源快照和候选处理状态同事务提交。变更记录不外键关联可删除的迭代、会话和消息；项目删除才清理记录。`project_files.filename` 已改二进制排序规则，以精确路径区分大小写。目录和上下文同版查询现在读取最近写入迭代与可撤回事实；旧 API 写入的文件尚无 v1.41 来源记录，仍显示未记录。更改 marker 解析、候选状态或写入协议时须回归 `verify-v141-first-file-candidate.mjs`、`verify-v141-manual-context.mjs` 与文件树脚本。
- **v1.41 #08 原型 HTML 快照**：原型阶段 `%%%HTML_BEGIN%%%` / `%%%HTML_END%%%` 由 `iteration-prototype-snapshots.ts` 校验单个完整 HTML 和 3 MiB 上限；`mysql-iteration-workbench.ts` 在成功回复的同一事务中写 `prototype_snapshots`，其 `iteration_id`、`session_id`、`message_id` 保留来源而不外键关联可删除会话。列表 API 按项目 ownership 和迭代归属筛选，详情路由的 view/download 使用带 `sandbox allow-scripts` 的 CSP；`PrototypeSnapshotPanel.tsx` 只在原型阶段显示独立快照，项目文件树和上下文仍只读 `project_files`。失败回滚不增快照或改已有候选，失败消息可重试。更改 HTML marker、快照事务或预览隔离时回归 `verify-v141-prototype-snapshot.mjs`、`verify-v141-manual-context.mjs`。
- **v1.41 #09 原型 Markdown 候选**：`mysql-iteration-candidates.ts` 从原型阶段单个正式 `%%%FILE_BEGIN%%% 原型-描述.md` / `%%%FILE_END%%%` 块建立会话内候选；`markdown-candidate-filename.ts` 按来源阶段校验树枝前缀，候选确认路由按会话阶段写入 `project_files` 与 `project_file_changes`，复用 #07 的原子事务、放弃和故障重试边界。`MarkdownCandidateReview.tsx` 复用候选交互并按阶段显示原型树枝；同轮 HTML 快照仍独立写入 `prototype_snapshots`。修改此协议须回归 `verify-v141-prototype-markdown.mjs`、`verify-v141-first-file-candidate.mjs` 和 `verify-v141-prototype-snapshot.mjs`。
- **v1.41 #10 PRD 候选**：PRD 阶段只从 `%%%FILE_BEGIN%%% PRD-描述.md` 的单个正式块提取六章依次齐全且每章有内容的 Markdown 候选；`markdown-candidate-filename.ts` 与确认事务按来源阶段限制为 PRD 树枝，确认后沿用 #07 的纯正文、唯一旧版、递增修订和永久来源记录。旧 `prd.md` 只作为历史文件保留，不是新工作台候选文件名。`mysql-iteration-workbench.ts` 的阶段末尾提示词覆盖旧冻结和自动读取假设，replay 的新工作台输出也使用 `PRD-` 前缀。更改此协议须回归 `verify-v141-prd-delivery.mjs`、`verify-v141-first-file-candidate.mjs`、`verify-v141-prototype-markdown.mjs` 和 `verify-v141-manual-context.mjs`。
- **v1.41 #11 普通文件修订**：`mysql-file-revisions.ts` 在项目、迭代和普通文件锁内以同一事务处理用户 `edit` / `restore`：编辑以当前正文替换唯一 `previous_content`，撤回写成新修订并清空备份，两者都追加 `project_file_changes` 用户来源记录；`0016_v141_file_edit_restore` 扩展操作枚举。新工作台从文件预览调用 `/api/iterations/[id]/files/[fileId]`；旧文件 PATCH 在携带当前迭代头时也走相同事务并保留旧响应字段，旧文件 POST 在项目已有产品迭代时拒绝正式写入（replay 夹具除外）。目录和提示词的可撤回事实继续由 `previous_content IS NOT NULL` 决定。修改修订事务或响应时回归 `verify-v141-file-revisions.mjs`、`verify-v141-first-file-candidate.mjs`、`verify-v141-manual-context.mjs` 与文件树脚本。
- **v1.41 #12 文件详情与来源**：`0017_v141_file_history` 为 `project_file_changes` 增加 `rename` / `delete`、可空正文修订、改名前路径和稳定排序序列；`mysql-file-history.ts` 按项目 ownership 读取详情与本轮写入，并在项目→迭代→文件锁内原子改名或删除。用户操作不伪造阶段/会话/消息来源；来源迭代删除后由快照呈现，`file_id` 保留已删除占位。项目文件目录包含轻量删除占位，但上下文与 Agent 提示词仍只读存活的 `project_files`；最近正文来源查询排除非正文操作。`ProjectFileTree.tsx` 连接详情抽屉，`ProductIterationWorkbench.tsx` 提供本轮写入。修改此边界时回归 `verify-v141-file-history.mjs`、`verify-v141-file-revisions.mjs`、首条候选、手动上下文和文件树脚本。
- **v1.41 #13 任务文件夹归属**：`0018_v141_task_folder_ownership` 的 `task_folders` 以项目和所属迭代唯一，保存稳定迭代编号、下一个不复用 issue 序号及唯一整套旧集合；`project_files.task_folder_id` / `issue_number` 绑定已归属 issue，`0019_v141_task_deleted_ownership` 为变更记录保存任务文件夹身份，让已删占位留在原目录，`0020_v141_backfill_task_ownership` 回填 0018→0019 过渡期间的变更记录。旧 `issues/` 文件保持未归属只读。文件夹不外键依赖可删除迭代，归档状态通过 LEFT JOIN 判断，不能转移。`mysql-task-folders.ts` 在项目→迭代→文件夹→issue 锁内处理所属用户操作和整套撤回，`project_file_changes.task_change_group_id` 归组；跨迭代只允许读取、下载和上下文加载。`ProjectFileTree.tsx` 标示所属、只读与归档，旧文件修改和旧 ticket 交付 API 不得绕过新归属。改变路径、归属或撤回协议时回归 `verify-v141-task-folder-ownership.mjs`、文件详情、修订、手动上下文及文件树脚本；14 号票负责候选集合的实际提交和序号分配。
- **v1.41 #14 任务集合候选与提交**：`0021_v141_task_set_candidates` 保存 Agent 完成回复或用户手动提案消息的整套候选，随消息/会话删除。`mysql-task-set-candidates.ts` 从完整 `issues/NN-描述.md` 块提取集合；`%%%TASK_SET_EMPTY%%%` 只表示明确清空提案。已存在的所属 issue 按稳定序号保留身份，新成员按文件夹计数器分配不复用序号，并用同一依赖字段规则校验及改写标题/Blocked by 引用（含缩进、大小写变体）。审阅摘要核对当前完整集合，确认在项目→迭代→文件夹→issue 锁内同事务提交全部成员、唯一旧集合、序号计数、候选终态及同组来源记录；失败候选仍 pending，首次失败不留下文件夹。手动提案归因 user，Agent 提案归因 agent；`mysql-iteration-workbench.ts` 用户消息编辑成功时同事务删除该消息的旧任务候选，失败不失效。`TaskSetCandidateReview.tsx` 只整套确认/放弃，`TaskSetManualProposal.tsx` 逐项编辑后缀和正文，前端不暴露文件 marker。提交不推断阶段状态，完成后仍可处理已有候选。修改解析、编号、来源或提交协议时回归 `verify-v141-task-set-submit.mjs`、任务归属、首条候选、手动上下文、文件树、详情来源、修订和迭代生命周期脚本。
- **v1.41 #15 任务整套撤回**：`restoreMysqlTaskFolder` 在原有项目→迭代→文件夹→issue 事务锁内恢复唯一旧集合，以新变更组记录用户操作；被删项沿用稳定身份与序号生成 restore 修订，新增项删除、纯改名不增正文修订，不回退 `next_issue_number`。清空 `previous_snapshot` 与恢复同事务提交，空数组是有效的空集合快照，NULL 才表示不可撤回。PATCH 成功返回 `folderId`、`groupId`、`canUndo: false` 和不含正文的 `entries`（removed/restored/content/rename/unchanged，renamed 标记），只有提交成功才呈现恢复明细。`ProjectFileTree.tsx` 复用普通文件撤回确认及任务差异展示，保留无快照禁用说明，文件列表变化或 409 后重新读取文件夹事实；操作失败与目录加载失败分开显示。改变恢复事务或反馈时回归 `verify-v141-task-set-undo.mjs`、任务提交、任务归属、文件修订、文件详情、项目文件树与手动上下文脚本。

- **v1.44 退出与会话 Cookie 边界**：src/proxy.ts 精准排除 /api/auth 及子路径，其余请求仍执行原鉴权；代理响应与 GET/POST /api/auth/session 通过 auth-session-cookies.ts 移除有效会话续期 Cookie，保留空值清除、登录签发与其他 Cookie，防止退出前的迟到读取恢复登录。auth.ts 登录期限固定为签发起最多 30 天，session.expires 与原 JWT 对齐。改动这些入口需回归 verify-v144-auth-signout.mjs 的桌面/移动与可控迟到响应场景；不以串行退出成功替代竞态验证。

- **v1.44 邮箱认证边界**：src/lib/email-verification.ts 统一邮箱+用途验证码、发码/消费与账号事务；auth-rate-limit.ts 用同连接事务持锁完成 MySQL 共享计数自增与本次序号读取，登录额度绑定稳定 user.id，auth-email-route.ts 负责输入与无敏感信息的错误。email-code/register/reset-password 三个正式路由复用该入口；auth.ts 正常登录有独立限流，forgot-password 对游客放行。迁移0024仅增列/建表，旧 email_verified_at 保持NULL。生产邮件仅走auth-email-delivery.ts；auth-email-test-boundary.ts同时限制development/随机隔离库账号/本机URL与令牌，且只允许replay或严格匹配本机模型fixture的live模式，生产预检拒绝测试字段。修改这些边界时运行 verify:v144-email-auth / verify:v144-email-unconfigured / verify:v144-auth-limits，并回归退出竞态与基础回放；升级fixture先造0023旧schema再执行正式增量迁移。真实收信另取证，见 docs/verification/v144-email-auth.md。

- **v1.44 #03 账号管理与模型准入边界**：`0025_v144_account_controls` 增量保存 users.account_status 与停用元数据，`account_admin_actions` 独立保留运营审计。`account-controls.ts` 只按服务端 ADMIN_EMAILS 与数据库完整邮箱指定管理员，空配置默认拒绝；`requireAdmin()` 在页面和每项管理API独立执行，停用事务还会锁定并重新核验操作者。`auth.ts` 拒绝停用账号登录，`requireAuth()` 每请求查实时状态，`ai.ts` 的Stream/Completion进入回放或live前再次检查，不能只依赖旧JWT。停用与审计同事务且重试保留首次记录；密码找回不激活账号。修改这些边界需跑 `verify:v144-admin-controls`、`verify:v144-admin-unconfigured`，相邻回归邮箱认证、退出、基础回放和生产准备的共享AI边界；仅在随机隔离库和本机供应商替身验证。Next构建清理.next会与其中的隔离源码副本冲突，先完成专项清理再构建。生产指定管理员身份与配置进度见PROGRESS.md和验收记录，禁止默认测试提权。

- **v1.44 #04 积分来源、管理调整与查账契约**：迁移 `0026_v144_credit_ledger` 仅新增 `credit_sources` 与追加式 `credit_entries`，旧/新账号无来源即零余额，不补写赠送、购买或邮箱验证事实。`credit-values.ts` 用八位定点 bigint 与十进制字符串；`credits-ledger.ts` 的 `lockCreditUsers` 是后续兑换、预留结算、充值退款共同的账号锁顺序，所有来源更新/分摊/流水同事务，actor_id+request_id唯一且重放校验完整业务参数。管理员仅能赠送、补偿或纠正可用赠送，不能动预留或购买来源；购买实付与原始额度保留。个人 `GET /api/credits` 只用会话账号，管理 `/api/admin/users/[id]/credits` 逐接口鉴权，写事务内再次验证管理员，读账用一致性快照。`CreditLedger` 在发送前用会话存储保存操作身份，响应丢失和页面刷新沿用原key重试；流水保留来源与账号/操作者/业务上下文快照，不级联删除业务资金记录。修改这些边界需跑 `verify:v144-credits`，并回归管理员权限、退出和基础回放；专项使用随机隔离库、受限IPC资金初态夹具及真实应用进程重启，夹具不证明实际充值预留已实现。详见 `docs/credits-ledger-contract.md`。

- **v1.44 #05 赠送邀请码边界**：`0027_v144_gift_invites` 持久化首批、邀请码摘要、领取和管理审计；初始化明文仅返回一次，列表不返回明文。`gift-invites.ts` 先锁用户再锁码，READ COMMITTED 避免空领取唯一键的间隙锁死锁，额度来源/流水/领取/占码同事务提交；每用户、每码及请求标识另有唯一约束，注册兑换在邮箱验证建号成功后作为独立操作失败不回滚账号。邀请码允许大小写归一及 URL-safe `_`，兑换失败不消费资格。个人入口以服务端领取事实隐藏，重试键保存在当前浏览器会话；后台页面与每个管理API单独 `requireAdmin()`，仅允许作废未领取码并追加审计。变更这些事务或权限时运行 `verify:v144-gift-invites` 与 `verify:v144-credits`；专项使用随机隔离库和 replay，不证明真实邮件、目标机或生产验收。

- **v1.44 #06 官方模型请求计量**：迁移 `0028_v144_model_requests` 与 `model-metering.ts` 在 `ai.ts` 的 Stream/Completion 真实供应商边界记账，旧会话、阶段会话、润色共享该入口；replay 不写真实费用。可靠用量与适用价格分别验证，逐笔快照和 NULL 未知成本供后续结算；故障免单保留网站承担成本。`processing` 仅代表供应商完成，阶段正文与 `completeModelProcessing` 同事务后才成功；补标失败保留清理路径，超期 running/processing 在后台显示中断。后续扣分须读取持久终态，不能按 processing 结算。后台页面/API 独立鉴权，完整 ID 按二进制比较以兼容中文负例；页面禁缓存用 production 验证，Next development 会覆盖缓存头。改这些边界运行 `verify:v144-model-cost`，按影响回归积分、命名、管理员与退出；只用随机隔离库及本机供应商替身。`verify-v141-isolated-replay.mjs` 的 `captureProvider` 依赖共享 AI 函数中独立成行的 `if (!isLiveAI()) {` 定位，修改 replay 分支需保持该锚点。恢复限制和官方小样本见 `docs/verification/v144-model-usage-cost.md`，数据契约见 `docs/model-metering-contract.md`。

- **v1.44 #07 会话积分预留与结算**：迁移 `0029`（`mysql-bootstrap.ts:586`）独立保存调用身份、预算、来源、待核对与追溯快照，无业务级联外键。`conversation-credit-budget.ts:9` 接收实际完整 messages，保存输入预算/摘要与真实输出限制；离线字节 BPE 证据不覆盖当前供应商隐藏包装，不能宣称严格防透支，限制与最小修正见 `docs/conversation-credit-contract.md`。`model-metering.ts:44` 在同一个账号锁事务内完成积分预留、每日次数与模型记录，提交后才上游；finish/complete/markFailure 同事务提交模型终态与结算。`conversation-credits.ts:23/66` 先锁账号再读余额和来源，赠送优先；`appendCallEntries:48` 对 reserve/release 写零金额内部转移，settle 写负消费，各来源 before/after 连续推进。`mysql-iteration-workbench.ts:343/455/476` 先按原 key 重放终态；analysis 16384，其余阶段 32768，不截输入，输出 length 明确失败免单；正文/候选/快照与正常结算共事务。`ProductIterationWorkbench.tsx:182/304/515` 保留 500/502/网络/409 的未知结果身份，生成中仅轮询合并 creditCall，不覆盖实时正文；`ConversationCredits.tsx` 账号总余额与每条费用同账本。正常缺 usage/价格或超预算转 pending；崩溃遗留 reserved 的自动恢复、24h 到期由 #10 实现，中间状态不单独发布。改动回归 `verify-v144-conversation-credits.mjs`、`verify-v144-model-cost.mjs`、`verify-v144-credits.mjs`；涉及每日额度/流式同步再回归 production-preparation 和 replay-foundation。


- **v1.44 #08 润色积分与结果恢复**：迁移 0030 独立保存 polish_generation_results 正文，禁止业务级联删除。polish-generation.ts 以文件 UUID 复用会话互斥范围，账号+requestId+完整输入摘要保证重试；预览、完成标记与结算共用账号锁事务。polish/route.ts 的 POST 支持 JSON/SSE 完整结果，GET 按 ownership 查询原请求/最新结果，不重发上游；failed 也返回 creditCall。ai.ts 的 live Stream/Completion 及 startModelRequest 不再允许润色绕过预留；finish 非 stop 或空润色按失败免单。useFilePolish 同时用于旧 FileEditorModal 与当前 ProjectFileEditor，以账号+项目+文件隔离会话草稿、原请求和不采用状态，未知错误保留 key。应用结果只改草稿，保存仍走既有文件修订接口。修改这些契约运行 verify:v144-polish-credits，并回归 conversation-credits、model-cost、credits；JSON/SSE和旧编辑器兼容回归 production-preparation。#09/#10 及隐藏包装预算限制见 docs/conversation-credit-contract.md，证据见 docs/verification/v144-polish-credits.md。


- **v1.44 #09 停止与故障免单**：迁移 0031 增加 model_requests.stop_requested_at。model-request-control.ts 的 requestModelStop 必须在账号锁内调用；阶段/旧会话消息停止与持久意图同事务，润色 DELETE 与 GET/POST 共用 ownership。ai.ts 的真实 Stream/Completion 通过 watchModelStop 独立取消上游，user_stop 与浏览器断开分离；iteration-generation-stream/mysql-chat 断开只关闭传输。model-metering.finish 的账号锁事务保护 settled/released，故障后迟到证据只补网站成本；结算失败回滚后尝试免单，completeModelProcessing 拒绝已失败/停止的正文成功提交。conversation-credits 的 stopped_confirmed/stopped_usage_unconfirmed 对应按实结算/待核对，故障立即释放自身预留。正文、旧冻结及润色预览同事务完成，失败的重生成回复保留费用载体。修改运行 verify:v144-stop-billing，回归 polish/conversation/model-cost/credits；共享传输与旧会话再回归 generation-stream/production-preparation/replay-foundation；断开只结束传输的旧断言须与当前契约一致。仅隔离库与本机供应商替身，#10 负责崩溃恢复与24小时到期；详见 docs/verification/v144-stop-billing.md。
