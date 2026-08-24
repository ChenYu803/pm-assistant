# PROGRESS.md — 项目状态与交接（implement Agent 单点真相）

> 每个 implement 会话：**开始必读，结束必写**。决策见 CONTEXT.md、票状态以
> `.scratch/pm-assistant-v1.1/issues/` 为准——本文件是叙事摘要 + 当前任务指针，
> 不重复上述文档的细节。更新者：会话收尾的 implement Agent / 用户拍板时。

## 当前阶段

**v1.2 规格已发布（2026-08-22），#01 Markdown 安全渲染、#02 项目边界隔离、#03 文件协议/HTML 快照、#05 消息事实源、#06 生成恢复、#07 tab 并发和 #09 显式冻结协议已完成，后续票待实现**；v1.1（使用体验改进）综合 replay 验证已完成 —— 票 01 至票 08 均已完成；真实模型四环回归仅在发布候选或另行批准后安排。
v1.0 已验收（2026-08-11），四环流水线端到端走通。

## 已完成成果

- **v1.0（2026-08-11 验收）**：四环流水线（需求分析 → 原型 → PRD → 任务拆分）全链路走通，verify-v1-flow 82 断言全绿；PRD 六章结构、任务拆分 issues 文件集、工作文档/概念版机制落地。
- **v1.1 票 01（2026-08-11 完成）**：体验基础批三块——①文件更新修复（写入判定改「消息是否已写入」，实时新消息总是重新弹确认框更新文件，仅历史重放用文件名兜底；`ChatArea.tsx` 新增 `liveMessageIds` 解决扫描 effect 抢跑时序）；②工作记录命名与创建一步化（创建面板名称输入 + 回车即建、列表行内改名、顶栏点击改名，共用 `InlineNameInput`；POST work-records 支持可选 name）；③流水线空状态引导（`agent-constants` 收敛 `AGENT_TYPE_ICONS`/`PIPELINE_AGENT_TYPES`，空工作记录渲染四步全景、仅需求分析可点、锁定步骤轻提示）。**配套**：13 个 verify 脚本「确认创建」点击机械更新为「创建」按钮。
- **票 01 验证状态**：tsc ✓、eslint 无新增问题 ✓、针对性实测 16/16 ✓、verify-fixes 10/10 ✓；迁移后 ticket01 专项固定回放审计 14/14 ✓（实时同名文件更新、拒绝不落盘、刷新去重、命名、空状态）；verify-v1-flow replay 已执行，70 通过、10 失败、1 WARN，失败包括需求分析排除清单断言，以及现有 PRD replay fixture 与旧断言不一致，未归因于 ticket01。
- **v1.1 规划（2026-08-11）**：grill-with-docs 敲定体验改进 12 项 + 实测 bug（已写入文件无法更新）；spec 与 8 张票已发布。
- **v1.2 规格（2026-08-22）**：新增 `.scratch/pm-assistant-v1.2/spec.md`，覆盖安全输入、明确冻结、级联删除、消息恢复、并发、项目隔离、文件边界、HTML 快照和 tickets 版本交付；当前仅完成规格，尚未进入实现。
- **v1.2 票 01（2026-08-22）**：`MarkdownRenderer` 对链接协议、属性字符和代码围栏语言名实施安全白名单；HTML/属性注入保持为转义文本，危险链接降级为不可执行文本。新增 `verify-markdown-safety.mjs` replay 专项，8/8 通过；既有 `verify-fixes.mjs` Markdown 回归 10/10，tsc 与 lint 通过。

## 本次任务

**v1.3 #09 已实现，待 MySQL 环境验证（2026-08-24）**：审计 #07 未提交的 MySQL-only 收口尝试后，对话、消息、冻结、tab、工作记录和自动命名公开入口现只接受 UUID 并走 MySQL ownership，不再为旧 ObjectId 回退 MongoDB。保留 #08 的 tab/消息删除、截断、请求幂等与版本冲突路径。工作区移除 `isMysqlWorkspace` / `isMysqlId` 分流，UUID 用户重新获得聊天、tab 关闭、消息管理、文件上下文、文件树、任务版本与冻结控件。MySQL 聊天直接读取 MySQL 上下文，恢复冻结后的 Agent 系统提醒，并在冻结生成 SSE `start` 事件返回 `generating` 状态。`npx tsc --noEmit`、相关 replay 脚本语法和 `git diff --check` 通过；MySQL 专项未运行，因为 `.env.local` 缺完整 MySQL 连接变量且本机无 Playwright Chromium。#10 项目成果 API 遗留改动保持未暂存；下一 frontier：配置环境后跑 #08/#09 专项，再推进 #10。

**v1.3 #08 已实现，待 MySQL 环境验证（2026-08-24）**：UUID tab 现可在单个 MySQL 事务中删除，并清理 `agent_file_contexts`、`message_file_writes`、消息替换引用、消息及 `tab_operations`；专用 tombstone 操作表保留已物理删除 tab 的 `{ tabId, requestId }` 重放结果。消息 DELETE 支持单条删除与从用户消息开始的全量截断，都会处理来源、替换链/自引用、ownership、版本冲突和幂等；运行中的生成持有 tab 操作锁，删除会明确冲突。MySQL 工作区重新显示 tab 关闭入口并提交 `expectedVersion + requestId`。新增 `verify:mysql-tab-message-mutations` 覆盖 tab/消息删除、截断、非用户拒绝、ownership、冲突、幂等、外键清理、生成互斥与两类回滚。脚本语法、`npx tsc --noEmit`、相关 lint、`git diff --check` 通过；专项未运行，因为 `.env.local` 缺完整 MySQL 连接变量且本机无 Playwright Chromium。下一 frontier：配置 MySQL 与 Chromium 后运行 #08 专项；随后进入 #09 的对话/工作区 MySQL-only 收口。

**v1.3 #07 已拆分（2026-08-24）**：审查 handoff、当前未提交 diff 与依赖清单后，确认 #07 同时承担缺失行为补齐、两组 API/UI 收口、生产依赖删除、23 个 Mongo 相关验证脚本迁移和最终发布验收，已超过单个新上下文可可靠完成的范围。保留 #07 为总目标，新增 #08 tab/消息删除与截断、#09 对话/工作区 MySQL-only、#10 项目成果 API MySQL-only、#11 移除生产 Mongo 依赖、#12 验证基础设施迁移、#13 综合回放与发布验收。现有 25 个文件、约 3600 行删除的未提交收口尝试原样保留，作为 #09/#10 的审计输入，不能因类型检查通过直接交付。下一 frontier：#08；#10 在其既有 blocker 具备后可独立推进。

**v1.3 #07 进行中（2026-08-24）**：已将项目、工作记录、聊天、冻结、文件上下文、项目文件、快照、tickets 与自动命名 API 收口为 UUID/MySQL 路径，并通过 `npx tsc --noEmit`。收口审计发现旧 Mongo 回退仍实际承载 tab 删除和消息删除/截断；MySQL 尚未有等价事务实现，因此 #07 不能标记完成，也不能删除 `mongoose` 依赖或旧模型。下一步必须先补齐这些 MySQL 操作、将前端的旧 ID 分流移除，再删除遗留代码并运行 MySQL 综合 replay。

**v1.3 #06 已实现，待 MySQL 环境验证（2026-08-24）**：UUID 项目/工作记录删除现使用专用 MySQL 事务：锁定拥有者父级后，按文件上下文、消息文件来源、消息恢复引用、消息、tab 操作、tab、工作记录、项目文件与快照的依赖顺序清理，最后物理删除父级。消息互相引用在删除前解除，避免外键阻断合法级联；事务回滚后可重试，项目/工作记录级边界分别保留或清理项目资产。新增 `verify:mysql-cascade-delete`，覆盖项目和工作记录的可观察关联结果、旧 URL、重复删除与中途故障的完整回滚。`npx tsc --noEmit`、`npm run lint`（仅 `ChatArea.tsx` 既有 1 条 warning）、`npm run build`、脚本语法与 diff check 通过；专项 replay 未运行，因为 `.env.local` 仍缺完整 MySQL 连接变量，且本机没有 Playwright Chromium。下一 frontier：配置 MySQL 与 Chromium 后运行 #01 至 #06 专项，再进入 #07。

**v1.3 #05 已实现，待 MySQL 环境验证（2026-08-24）**：MySQL `tabs` 现持久化冻结消息、目标文件、正文摘要与错误状态；`project_files` 持久化文件绑定并拒绝普通写入、编辑和删除。MVP-PRD 与原型只会由当前轮 `%%%SCOPE_FREEZE_PROPOSAL%%%` 进入提议态，显式控件才可发起 `freeze-generate`；生成、失败、待写入、取消和正式冻结均经 tab 操作记录与事务化条件更新处理。新增 `verify:mysql-explicit-freeze`，覆盖提议、否定句、失败重试、重复请求、缺文件、取消、正确写入冻结、文件锁定和 MySQL 绑定。`npx tsc --noEmit`、`npm run lint`（仅 2 条既有 warning）、`npm run build`、脚本语法与 diff check 通过；专项 replay 尚未运行，因为本机仍缺 MySQL 连接变量与 Playwright Chromium。下一 frontier：配置环境后运行 #01 至 #05 专项，再进入 #06。

**v1.3 #04 已实现，待 MySQL 环境验证（2026-08-24）**：新增 `project_files`、`agent_file_contexts`、`prototype_snapshots`、`message_file_writes` 的 #0005 migration 及统一 MySQL 成果仓储；UUID 项目的文件创建/更新/版本、Agent 来源、上下文加载、HTML 快照与 tickets 整套替换/另存/下载均已切换到事务化 MySQL 路径，普通文件树不包含快照。消息读取返回精确文件来源，MySQL 聊天会注入已加载文件，并修复 UUID 的重生成/编辑/重试参数校验。新增 `verify:mysql-project-artifacts` 覆盖消息输出 → 文件确认 → 上下文加载 → 快照回看 → tickets 替换/另存/下载与数据库关联。`npx tsc --noEmit`、`npm run lint`（仅 2 条既有 warning）、`npm run build`、脚本语法与 diff check 通过；专项 replay 未运行，因为环境仍未配置 MySQL 连接变量且本机缺 Playwright Chromium。ticket 状态为 `implemented-pending-mysql-verification`。下一 frontier：配置 MySQL 与 Playwright 后一起运行 #01 至 #04 专项，再进入 #05。

**v1.3 #03 已实现，待 MySQL 环境验证（2026-08-24）**：新增 messages 关系表和可升级的 #0004 migration；MySQL UUID tab 现在使用事务中的版本号、活动操作锁和 `tab_operations` 重建发送、停止、重生成、编辑重发、requestId 重放与多窗口冲突。生成开始即插入正式 assistant，token 条件更新可被跨请求停止中断；失败/中断保留消息，替换链仅在同一事务内提交成功后隐藏旧历史。消息读取、停止与自动命名已按 UUID 分发到 MySQL，原 Mongo 路径暂留给尚未迁移的历史数据和后续 #04/#05/#06 范围。新增 `verify:mysql-conversation` 覆盖发送、刷新、失败/重试、重生成、编辑、停止和并发；脚本语法、`npx tsc --noEmit`、`npm run build` 与 diff check 通过。专项回放未运行：本机缺 Playwright Chromium，且 `.env.local` 仍缺 MySQL 连接变量；ticket 状态为 `implemented-pending-mysql-verification`。下一 frontier：安装/配置 MySQL 和 Playwright 后运行 #01/#02/#03 专项，再继续 #04。

**v1.3 MongoDB → MySQL grilling 第一阶段已完成（2026-08-24）**：已敲定 v1.3 只做存储底座替换、不迁移旧 MongoDB 数据、按空库全新注册；不提供切回 MongoDB 的产品回退路径，MongoDB 可留存但不作为应用依赖。目标环境为 Windows 本机 MySQL 9.7.2 LTS，未来部署配置不锁死；应用使用项目专用 MySQL 连接身份，Workbench 可继续使用 root。数据库结构由可重复执行的初始化/升级命令建立，真实连接信息通过环境变量/配置提供。验收必须覆盖全部 v1.2 固定回放并做一次从零人工冒烟；数据库类型对用户不可见；瞬断时当前操作明确失败、可手动重试。开发重置命令作为非阻塞辅助项，初始化失败不额外制作专门页面。架构决策见 `docs/adr/0005-mysql-as-v1-3-primary-database.md`；grilling 暂停，下一步应先将这些决策拆成 v1.3 spec/tickets，再进入实现。

**v1.3 #02 已实现，待 MySQL 环境验证（2026-08-24）**：账号、项目、工作记录和 tab 已切换为 MySQL 事实源；统一以 UUID 作为会话、URL、API 与关系表标识符。新增 users/projects/work_records/tabs 和 tab_operations 迁移，外键、名称非空约束、排序索引与 tab 改名幂等操作记录均由 MySQL 保证。注册/登录改从 MySQL 用户读取；项目、工作记录和 tab 的创建、读取、改名、ownership 与刷新恢复走 MySQL。项目列表提供改名入口；未迁移的文件、对话与删除入口不会对新 UUID 误发 MongoDB/ObjectId 请求，分别留给 #03、#04、#06 收口。新增 `verify:account-project-workspace`，覆盖注册、重复邮箱、关系、排序、改名重放、刷新恢复、跨用户拒绝和 MySQL 可观察关系。`npx tsc --noEmit`、`npm run build`、`git diff --check` 通过；全量 lint 仍只有既有 `src/app/api/projects/[id]/files/route.ts:305` 的 `prefer-const` error。专项回放因 `.env.local` 缺少 `MYSQL_HOST`、`MYSQL_DATABASE`、`MYSQL_USER`、`MYSQL_PASSWORD` 未运行，ticket 状态为 `implemented-pending-mysql-verification`。下一 frontier：配置本机 MySQL 后跑 #01/#02 专项并人工冒烟，再进入 #03。

**v1.3 spec 与 tickets 已发布（2026-08-24）**：按 `to-spec` 将 grilling 决策写入 `.scratch/pm-assistant-v1.3/spec.md`（`ready-for-agent`）；随后按 `to-tickets` 将最初 5 张横向/过粗票替换为 7 张 tracer-bullet 票：#01 MySQL 空库与初始化基础、#02 账号/项目/工作区骨架、#03 对话恢复与并发、#04 项目成果与 tickets、#05 显式冻结、#06 级联删除、#07 MySQL 单库收口与综合验收。采用 expand–contract：#01 先扩展且保持现有行为，#02–#06 按用户流程迁移，#07 删除 MongoDB 运行依赖并综合验收。最高测试 seam 是 MySQL 空库上的 replay/API 综合入口 + 一次从零人工冒烟；未纳入旧数据迁移、MongoDB 回退或实际线上部署。

**v1.3 #01 已完成（2026-08-24）**：引入 `mysql2` 数据访问入口，保留所有 MongoDB 调用不变；新增基于 `.env.local` 的 MySQL 配置、精确 MySQL 9.7.2 验证、可重复的 `db:init`（项目库、`schema_migrations` 与专用应用账号）和 `verify:mysql-init`。网站账号拒绝使用 root 或维护者身份；已存在账号只有 `USAGE` 与本项目 DML 时才允许重复初始化，避免修改其他服务账号。维护文档位于 `docs/mysql-local-setup.md`。`npx tsc --noEmit`、`npm run build`、配置/授权白名单固定检查和 diff check 通过；全量 lint 仍受未修改的 `files/route.ts:305` 既有 `prefer-const` error 阻塞。完整 MySQL 重复初始化验证尚待本机安装 MySQL、在 `.env.local` 填入变量后运行，当前命令已验证环境缺失时可定位失败且不泄露凭据。

**v1.2 #12 已完成（2026-08-24）**：新增 `scripts/verify-v12-replay.mjs`，固定以 `AI_MODE=replay` 探测服务端后按安全、冻结协议、生命周期、消息恢复、并发命名、项目文件边界和 tickets 交付顺序调用 11 个专项。综合入口只收集退出码与专项 `结果`，失败保留带专项类别的 ❌ 定位摘要；环境未就绪时明确报告未运行，不切换 live。修复 #10/#11 后验证夹具：项目边界与冻结注入写入显式携带 replay system-write 头，文件协议 ticket fixture 满足产品契约。综合回放 11/11 专项、165/165 断言通过；未运行 `verify-ticket-splitter.mjs`（#11 版本交付专项已覆盖整套候选契约，故无需重复执行）。入口语法、`npx tsc --noEmit`、`git diff --check` 通过。

**v1.2 #10 已完成（2026-08-24）**：新增 `MessageFileWrite` 持久化消息来源事实；每次项目文件写入记录消息、tab、项目、文件、创建/更新操作、文件版本、完成态与写入态。新 assistant 消息从 SSE `start` 即声明为实时，严格只认精确来源；仅缺少 `file_provenance_version` 的历史消息可按文件名兜底。产品 Agent 文件写入 API 必须提供已完成 assistant 来源并校验同 Agent、同项目；仅非生产 replay 的基础夹具可使用显式 system-write 测试旁路。重生成缺少已写文件时提供“更新文件”与“保持不变”，前者复用既有确认流并写入新来源记录，后者不覆盖。来源记录与文件写入事务优先；独立 MongoDB 回退时来源记录失败会按实际版本补偿撤销文件。`ProjectFile.version` 以原子递增覆盖 Agent 写入与手动编辑；消息、tab、工作记录和项目删除同步清理来源记录。`verify-message-file-provenance` 14/14、消息恢复 20/20、文件协议/快照 14/14、级联删除 23/23、`npx tsc --noEmit`、脚本语法与 diff check 均通过，全部使用 `AI_MODE=replay`。下一 frontier：v1.2 #11。

**v1.2 #11 已完成（2026-08-24）**：任务拆分候选结果按完整集合交付；产品 ticket 服务端校验 `What to build`、`Blocked by`、验收标准并拒绝 `Status`/`Implementation` 字段，仓库内部 ticket 的 `Status` 不受影响。新增项目级 ticket-set API：替换只更新根 `issues/` 完整集合，另存自动写入下一个 `issues/vN/`，旧版本保留；最大版本由文件集合推导为当前版本，不保存 current 标记。版本列表选择和下载均按完整版本集合返回，禁止候选跨版本混用；每张写入继续记录 #10 消息来源。新增 #11 replay 11/11，更新任务拆分回归 23/23；#10 来源 14/14、消息恢复 20/20、文件协议 14/14、级联删除 23/23、tsc 与脚本语法均通过。下一 frontier：v1.2 #12。

**v1.2 #06 已完成（2026-08-23）**：候选 assistant 独立生成，`replacement_committed` 是旧历史与新结果的可见性提交屏障；重生成/编辑失败不会预删历史，停止保留 partial 并持久化 `interrupted`，刷新时 `ChatArea` 每 500ms 从 messages API 对账生成态。重试使用新 `requestId`；聊天路由在任何写入前确认 `tab_id + request_id` 的部分唯一索引，旧重复数据只清除较晚消息的幂等标识、不删除消息内容。另修复零 token 空 assistant 的 schema 拒绝，以及 Next.js 16 将流式 Route Handler `request.signal` 误标为 aborted 的问题。`AI_MODE=replay node scripts/verify-message-recovery.mjs` 20/20、`npx tsc --noEmit`、脚本语法、`git diff --check` 已通过，未调用真实模型。下一 frontier：v1.2 #07。

**v1.2 #07 与 #09 已完成（2026-08-23）**：#07 为所有改变 tab 事实的操作统一 `expectedVersion + requestId` 乐观并发契约，持久化操作记录吸收重放，冲突固定提示“此标签页正在被其他窗口修改”，UI 只提供手动刷新。#09 将 PRD 与原型冻结迁移为 `idle → proposed → generating → awaiting_write → frozen` 的显式两阶段协议：Agent proposal 仅出现控件；自然语言与历史消息永不冻结；文档成功生成后走既有文件确认，写入成功才正式冻结，取消/失败不会冻结。消息历史从持久化事实对账 tab 版本和冻结状态，处理中刷新能恢复为待写入确认；本轮生成正文的 SHA-256 摘要与项目文件比对，阻止同名旧文件错误冻结。完成冻结会原子绑定对应项目文件，随后 POST/PATCH/DELETE 均不能覆盖或删除它。专项 replay：#07 16/16、#09 19/19、消息恢复 20/20、文件协议/快照 14/14、协议检查 22/22；`tsc`、脚本语法与 diff check 通过，未调用真实模型。下一 frontier：v1.2 #04（不在本次范围）。

**v1.2 #04 已完成（2026-08-23）**：项目/工作记录删除先进入内部删除态，正常路径物理级联工作记录、tab、消息、文件上下文、项目文件、快照与 tab 操作记录；事务优先，不支持事务时按可重入补偿清理，故障与重复请求返回明确结果。用户选择“最终清理”：极端慢写入在父级物理删除后才落库时，写入收尾会立即按 ownership 链补扫；本地应用重新打开项目列表也会补扫，允许短暂内部残留但不会让用户重新访问已删项目。专项 replay 23/23、项目边界 13/13、`npx tsc --noEmit`、定向 lint、脚本语法和 diff check 通过，未调用真实模型。#08 已完成；后续按 v1.2 排期推进。

**v1.2 #08 已完成（2026-08-23）**：自动命名改为 `name: "未命名"` 的条件更新，手动改名或其他 tab 先成功后，迟到的自动结果不会覆盖。聊天完成后页面另发命名请求，服务端验证工作记录、标签页和当前用户归属；命名失败只安静跳过，不影响已完成聊天或之后的手动改名。专项 replay 5/5、`npx tsc --noEmit`、脚本语法和 diff check 通过，全程未调用真实模型；定向 lint 无 error，保留 `ChatArea.tsx` 既有的一条 Hook 依赖 warning。

**本次任务：v1.2 票 02、票 03 已完成（2026-08-22）**：#02 的文件 API 现在同时校验用户、URL 项目与文件父项目；tab 文件加载/移除和聊天上下文过滤项目 ownership，历史跨项目上下文不会进入公开列表或 Agent 上下文；非法 `fileId` 返回 400 参数错误，合法但不存在返回 404。新增 `scripts/verify-project-boundary.mjs` replay/API 专项，13/13 通过。#03 新增根文件与 issues 路径白名单、控制字符/扩展名/Agent 校验、3 MiB 限制和独立 `PrototypeSnapshot` 多版本资产 API；HTML marker 在原型 UI 完成后自动保存，快照不进入普通文件树或 Agent 上下文。新增 `scripts/verify-file-protocol-snapshots.mjs`，14/14 通过；任务拆分相邻 replay 22/22 通过；tsc、全量 lint 和 diff check 通过，未调用真实模型。下一 frontier 是 v1.2 票 04。v1.1 票 08 的综合固定回放入口仍覆盖 6 个专项、115 条断言（17 + 28 + 25 + 12 + 6 + 27），未调用真实模型；发布候选时若需完整四环 live 回归，仍须先报备验证假设、轮数和 token/API 成本并取得同意。

**MySQL 教学工作区已建立（2026-08-24）**：根据用户的明确学习目标新增 `MISSION.md`、`RESOURCES.md`、`NOTES.md`，以及 `lessons/0001-mysql-first-map.html`、`lessons/0002-mysql-install-windows.html`、`reference/mysql-vs-mongodb-quick-reference.html` 和共享样式。教学范围限定为 AI 产品经理需要的数据库概念、迁移风险、版本选择和验收判断；不改动当前 MongoDB/Mongoose 实现，不自动下载或安装软件。官方资料已核对，后续等待用户完成第一课自测或开始安装。

**MySQL 版本轨道说明已校准（2026-08-24）**：用户指出官方 Community Server 下载页同时展示 `26.7.0` 和 `9.7.2 LTS`。教学材料补充说明 Innovation 与 LTS 的区别，当前项目暂定 `9.7.2 LTS` 为第一候选，`8.4.11 LTS` 为兼容性备选；不因最高版本号直接选择 `26.7.0`。

**MySQL 下载入口说明已补充（2026-08-24）**：若选择 `9.7.2 LTS`，应从 Community Server 页面下载对应 Windows MSI；独立的 MySQL Installer 页面当前主要提供 `8.0.46`，只有实现方案明确要求旧安装器时才使用它，避免初学者把两个入口和版本混在一起。

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
