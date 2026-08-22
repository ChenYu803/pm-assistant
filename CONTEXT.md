# PM Assistant — Domain Glossary

> Work in progress. Updated as `/grill-with-docs` resolves decisions.

## Core concept

**PM Assistant** is a website that serves as a PM's workflow companion. Instead of cramming the entire PM workflow into one AI conversation, it splits the work across specialized agents arranged in a pipeline. Each agent owns one phase of the workflow and produces a markdown artifact; the next agent in the chain reads that artifact and continues.

## Product decisions (so far)

| Decision | Resolution | Rationale |
|---|---|---|
| Product form | Website | User-facing, accessible to non-technical PMs |
| Agent role | The website IS the chat interface | Users talk to specialized agents directly in the browser |
| File storage | Server-side, per-user project spaces | Auto-archiving, zero-friction handoff between agents; downloads also available |
| Target workflow | 需求收集 → 需求分析 → 原型产出 → PRD撰写/迭代 → 任务拆分 (用户外部 vibe coding 为终点) | 四环 v1 pipeline,= matt 主流程产品化(grill / prototype / to-spec / to-tickets) |
| Navigation mode | Hybrid — light progress indicator shows current phase, but user is never locked; skip/back/jump-in always allowed | Guides novices without constraining experienced users |
| 空状态引导 | 新工作记录无标签页时展示四步流水线全景（需求分析→原型→PRD→任务拆分，每步职责一句话），仅「需求分析」可点击创建，后三步锁定显示「完成前置步骤后开启」；点击锁定步骤给轻提示。已有标签页后，TabBar「+」开新 tab 仍走完整 Agent 选择 | v1.1 决策（2026-08-11）：新人只被引导做第一步，同时看得见完整旅程 |
| v1.1 范围（2026-08-11 grill-with-docs 敲定） | ① 体验改进 4 项：工作记录手动命名 / 空状态引导 / Agent 自我说明 / 对话框功能 ② 补充 4 项：文件批量确认 / 上下文长度预警 / 工作记录创建一步化 / 重生成与文件一致性提示 ③ Bug 修复：已写入文件无法更新（见下） | 每子版本解决一类问题；v1.2+ 才轮到各 Agent 专属 bug |
| v1.2 冻结触发（2026-08-22 grill-with-docs） | 自然语言（包括肯定词、否定句和历史消息）正式退出冻结协议；冻结必须由用户明确操作触发，具体控件与确认 API 形式待下一轮决定 | 消除聊天文本被误解释为不可逆流程操作的风险 |
| v1.2 冻结交互（2026-08-22 grill-with-docs） | Agent 提议冻结时显示明确操作控件；用户确认后进入“冻结处理中”，随后生成文档；文档生成完成后再弹文件写入确认，写入确认后才成为正式冻结；技术上由专用确认 API + 幂等请求保证重复点击不重复推进 | 将“冻结范围”和“写入文件”拆成两个可理解、可取消的用户动作，并允许生成失败后恢复 |
| v1.2 Markdown 安全（2026-08-22 grill-with-docs） | Markdown 链接仅允许 `http`、`https`、`mailto`；危险协议、属性注入和不安全代码围栏语言名均被清洗或降级 | 防止 Agent 输出的 Markdown 在用户浏览器中执行脚本或破坏页面结构 |
| v1.2 重生成/编辑失败语义（2026-08-22 grill-with-docs） | 先生成新结果，成功后再一次性替换旧历史；失败保留旧消息并显示失败状态；取消保留已生成部分并标记中断；刷新/重连以服务端状态恢复 | 让失败、取消和重试都可预测，不丢失用户已经看到的内容 |
| v1.2 生成消息事实源（2026-08-22 grill-with-docs） | 生成开始时由服务端预创建 assistant 消息并返回正式 ID；消息状态区分生成中、完成、中断、失败；即使零 token 失败也保留失败状态的空 assistant 消息；前端不再创建无服务端 ID 的中断临时消息 | 让停止、失败、刷新和重连都围绕同一条正式消息对账，避免重复气泡 |
| v1.2 tab 并发（2026-08-22 grill-with-docs） | 采用版本号 + 幂等键组合；不同操作版本冲突返回明确冲突，产品提示“此标签页正在被其他窗口修改”，由用户手动决定 | 同时解决多窗口覆盖和网络重试重复写入两类问题 |
| v1.2 文件写入边界（2026-08-22 grill-with-docs） | 采用根文件白名单、受控中间文件和 `issues/NN-<slug>.md` 路径规则；中间文件允许存在但不可加载；单文件上限 3 MiB；HTML 快照持久化到项目范围，支持多个版本，但不出现在普通文件树，也不可加载进 Agent 上下文 | 防止文件树污染和协议绕过，同时保留可回看的原型预览版本 |
| v1.2 任务拆分交付格式（2026-08-22） | 任务拆分 Agent 输出的是交给外部编程 AI 的稳定交付契约：保留用户视角交付行为、`Blocked by` 和验收标准及必要 PRD 引用；不包含 `Status` 或 `Implementation` | 产品借鉴 `/to-tickets` 的垂直切片与依赖规则，但不提供 matt issue tracker / implement 生命周期；动态实现进度不属于任务拆分产物 |
| v1.2 任务重新切分（2026-08-22） | 已写入 tickets 后重新切分，先生成新结果并由用户明确选择“替换现有 tickets”或“另存新版本”；系统不静默覆盖旧交付物 | tickets 可能已经交给外部编程 AI，必须避免无提示地改变用户手上的交付版本，同时保留 PRD 迭代能力 |
| v1.2 tickets 版本保存（2026-08-22） | 选择“另存新版本”时，tickets 写入 `issues/vN/` 子目录并保留旧版本；版本作为同一 tickets 交付物的可回看目录，不静默混入当前版本 | 保留历史交付物，同时让用户能按目录选择一整套 tickets 交给外部编程 AI |
| v1.2 tickets 当前版本（2026-08-22） | `issues/vN/` 中编号最大的版本自动视为当前版本；用户无需额外手动标记，旧版本仍可回看和下载 | 面向求职 PM 的交付流程优先减少版本选择负担，同时保留历史交付物 |
| v1.2 删除失败语义（2026-08-22 grill-with-docs） | 删除采用“支持事务时事务，不支持时幂等补偿清理”的组合方案；只有全部目标数据确认清理后才报告成功 | 在不同 MongoDB 部署能力下维持物理级联删除的一致用户结果 |
| v1.2 消息级文件写入来源（2026-08-22 grill-with-docs） | 持久化消息 ID 与文件名、操作类型、版本/状态的关联事件；刷新、重试和重生成优先使用消息级来源，旧数据才按文件名兜底 | 防止不同消息输出同名文件时把旧写入误判为当前消息写入 |
| 原型 HTML 快照 | 原型 Agent 生成的可下载 HTML 预览，用于浏览器中的可视化确认；它不是项目文件树中的正式交付物，确认后的正式交付物是原型.md | 预览可以快速反复生成而不污染项目文件；后续 Agent 读取结构化原型文本，避免把展示媒介当成单一事实来源 |
| 文件更新 bug（v1.1 修复） | 正式文件（需求分析.md/原型.md/prd.md）写入后，后续对话中 Agent 输出同名 marker 不再触发写入判定——前端 `existingFileNames.includes(filename)` 拦截（US39 刷新去重误伤正常更新），文件永不更新。工作文档（静默写入路径）不受影响；issues/ 编号文件概率低。**修复方向**：判定依据从「文件名已存在」改为「该消息是否已写入」，仅历史重放扫描用文件名兜底 | 2026-08-11 用户实测发现；服务端 POST /files 本就支持更新（需求分析 append / 其他 replace） |
| 文件批量确认（v1.1） | 任务拆分 Agent 一次输出多个文件时，现状逐条弹确认框（6 个文件点 6 次）。改为：一次列出全部待确认文件（勾选），批量写入/丢弃 | 2026-08-11 建议采纳；保留逐条确认的「拒绝不落盘」语义 |
| 上下文长度预警（v1.1） | 输入框附近显示对话上下文粗略用量，接近上限时预警。**实现红线**：估算必须便宜（字符数/4 粗估，不接受精确计算/调 LLM）；显示在辅助位，失败/异常静默降级为不显示；不得阻塞或拖慢聊天主流程（与 auto-name 20s 超时同理：辅助功能可牺牲，核心链路不可阻塞） | 2026-08-11 建议采纳；对话历史全量进 LLM（chat/route.ts 无截断） |
| 工作记录创建一步化（v1.1） | 现状两步（点「新建工作记录」→ 弹确认面板 → 再点「确认创建」）合并为一步：创建面板直接含名称输入框，输入 + 回车即创建 | 2026-08-11 建议采纳；与「创建时可选填名称」决策天然衔接 |
| 重生成与文件一致性提示（v1.1） | 替换式重新输出时，若旧回复的文件已写入项目，且重新生成的回复未再输出该文件，提示用户「已写入文件与新回复可能不同步，是否更新/保持不变」；用户确认后走既有写入流程（更新 = POST /files 覆盖或 append） | 2026-08-11 建议采纳；防止 vibe coding 链路拿到新旧不一致的文件 |
| v1 priority | Process efficiency ("B") to 90 points; agent output quality ("A") as baseline; history ("C") limited | Flow is the moat; prompt quality can improve incrementally |
| Agent 自我说明 | 选择标签页时（AgentTypeDialog）：每个 Agent 重写一句话「干什么」+ 结构化四段说明（职责一句话 / 需要你提供什么 / 会产出什么 / 在流水线中的位置）。tab 空状态保留「现在该说什么」的操作提示并重写更直白；四段说明不在 tab 内重复 | v1.1 决策（2026-08-11）：强引导性——求职 PM 不懂 PM 流程，得知道「我带什么来、能带走什么」 |
| 目标用户群 | **求职 PM**（无 PM 工作经验的求职者；产品作者本人即典型用户）。原「在职 PM」定位作废（见 ADR-0001） | Dogfooding 兼作简历叙事；MVP 已验证流水线概念，v1.0 验证「新人也走得通」 |
| 增长策略（三步走） | ① 自己作为唯一用户，把产品打磨成「自己想要的样子」 ② 以教学之名经营小红书等社群，引流其他求职 PM 使用 ③ 未来随用户群成长回在职 PM 市场 | 先做深单点再扩张；教学是引流手段，产品价值是「从想法到 PRD 的完整产出」 |
| 核心体验目标 | 新人无引导也能走完「想法 → 需求分析.md → 原型.md → prd.md → issues」并导出成果 | 求职 PM 不懂 PM 流程，产品必须自己教会他们；需模板案例、新手引导、成果导出支撑 |
| Agent design | Each agent has a baked-in system prompt for its specific role | User never writes "you are a PM" — they just describe their situation |
| AI backend | OpenAI-compatible Chat Completions API；供应商、地址和模型由 `AI_*` 环境变量配置；本地验证默认使用固定回放 | 业务代码不绑定具体供应商；真实 GPT 验证只负责检查模型对 prompt 的理解，UI 和协议由离线回放验证 |
| MVP agents | ① 需求分析 Agent — Requirement Analyst ② MVP-PRD Agent — MVP Scope & PRD Writer | Two agents; validates both specialization AND handoff |
| v1.0 agents(四环流水线) | ① 需求分析 Agent(微调:功能范围段充实,做 X + 不做 Y 及理由)② 原型 Agent(新增)③ PRD Agent(重构:六章)④ 任务拆分 Agent(新增) | = matt 主流程产品化(grill / prototype / to-spec / to-tickets);细节见 `.scratch/prd-structure/ai-prd-structure.md` |
| 需求分析.md format | List of requirements, each with 4-section analysis (用户与场景 / 用户故事 / 功能范围 / 成功指标). 功能范围段充实:做 X + 不做 Y(理由)——范围界定与排除理由是需求分析 Agent 的职责,PRD 第 2 章引用 | Agent is gatekeeper, not scribe — only validated requirements enter the list;需求分析就做需求分析该做的事,不越界 |
| File editing | User can edit any file inline; AI polishes to proper md format afterward | User has final say over content |
| prd.md format | 六章骨架（读者是 AI，见 ADR-0002/0003）：① 概念（含外部依赖声明）② Out of Scope（排除项附理由）③ 页面清单（目的/元素/操作/入口出口/依赖）④ 实体级数据模型（字段单源聚合 + 状态机）⑤ 用户流程+验收标准（按用户故事组织，异常并入分支）⑥ 文案基调（一行） | 单源/可定位/显式边界/可验证原则；精简版 PRD 退役为纯流程确认产物（不落盘）；Testing Decisions 不进（「怎么测」=技术决策） |
| PRD 结构原则（五条） | 完备性 / 单源事实 / 可定位 / 显式边界 / 可验证；另：**可切分性**是 PRD 质量的客观验收手段（切不动 = 结构缺陷） | 读者是 AI：重复=版本漂移，AI 随机信一个矛盾版本；不写排除项，AI 会因完成主义做过头 |
| PRD 的读者 | **AI**（「只会执行的程序员」）——「直接拿去 vibe coding」是字面要求，不是「稍作补充」 | v1.0 定稿（见 ADR-0002）；现有五维度结构对人友好、对 AI 太粗犷，v1.0 将重构 PRD 结构 |
| v1.0 完成标志 | 作者本人（唯一用户）从零走完「想法 → 需求分析.md → 原型.md → prd.md → issues 文件集」，拿到的 PRD + issues 实际 vibe coding 一次跑通 | Dogfooding 兼作验收：PRD+issues 质量是产品唯一北极星，一切 Agent 均服务于「PRD → vibe coding 跑通」链路 |
| v1.0 核心课题 | ~~AI 执行版 PRD 结构设计~~——**已解决**（2026-08-07 分支会话）：六章骨架 + 四环流水线，成果见 `.scratch/prd-structure/ai-prd-structure.md`，决策入 ADR-0003/0004；to-spec 阶段登记为 ticket 展开实现 | 巨大且重要的问题，混在 grilling 里会稀释焦点——故岔出分支用空旷上下文解决 |
| v1.0 范围（已划线，更新版） | 进：PRD 结构重构（六章，精简版文档退役）、方案 B 输出保障（一次只问一个问题 / 显式确认推进 / 输出完整性保障 / 表格控制）、原型 Agent（新增）、任务拆分 Agent（新增）、需求分析 Agent 微调（功能范围段充实）。出（维持）：模板案例、新手引导、成果导出（下载功能 MVP 已有） | 只服务作者本人走通四环拿到可 vibe coding 的 PRD + issues |
| 需求分析.md 定位 | 四段结构保留；「成功指标」即使 AI 执行版 PRD 用不上也保留——对用户本人（学习 / 求职作品叙事）有独立价值 | 需求分析.md 不只是 PRD 的素材，自身是独立交付物 |
| 新增 Agent 选择标准 | 新增 Agent 以「提升『PRD → vibe coding 跑通』完整链路（PRD 质量本身 + 落地性）」为第一标准；新手引导性/环节丰富度为第二标准，不因「看起来丰富」而加 | 完成标志 = 作者拿到能 vibe coding 的 PRD + issues；PRD 质量高低由链路质量决定、由 vibe coding 成功与否评判 |
| 对话框功能（v1.1） | ①复制：消息 hover 复制按钮，复制渲染后纯文本（剥离 marker）②重新输出：替换式——重生成最后一条 AI 回复，旧回复从对话移除，可多次 ③删除对话：删除单条消息（用户/AI 均可，确认弹窗，不可恢复）④中断输出：流式期间显式「停止生成」按钮，中断后保留已生成内容（标注中断，作为上下文一部分；不满意可删）⑤智能滚动：向上翻历史不被新 token 拽回底部 ⑥流式期间输入框不禁用（仅禁发送）⑦编辑并重新发送：编辑用户消息 → 删除其后所有消息 → 重新生成 | v1.1 决策（2026-08-11）：学习市面 LLM 聊天框标配；「中断保留 + 单条删除」互为支撑 |
| Prompt 重写原则 | 大方参考公开优秀 skills（如 grill-me 的 relentless interview：一次一问、聚焦追问、不跳步），不闭门造车 | 需求分析 Agent 本质是 interviewer，直接借鉴成熟 interview 纪律 |

### Information architecture

```
Project (e.g., "校园二手交易平台")
├── 工作记录 A: "2025-08-05 初期规划"
│   ├── 需求分析 #1  →  analyzed requirement #1, contributed to 需求分析.md
│   ├── 需求分析 #2  →  analyzed requirement #2, contributed to 需求分析.md (independent context!)
│   ├── PRD #1       →  (deleted by user)
│   └── PRD #2       →  produced prd.md
├── 工作记录 B: "2025-08-06 迭代优化"
│   └── ...
└── File tree (shared across project)
    ├── 需求分析.md (changelog: requirement count, last editor, timestamp)
    ├── 原型.md (changelog: 页面/流程结构化文本, iteration #)
    ├── prd.md (changelog: version, iteration #)
    └── issues/ (NN-<slug>.md, 按 blocked-by 依赖序编号)
```

- **Project** — top-level container (the product being built)
- **工作记录 (Work Record)** — a "project team" within the project. Contains multiple tabs. State persists across browser sessions.
- **Tab (标签页)** — a "team member": one chat with one agent type. Each tab has **independent conversation context**. Multiple tabs of the same agent type (e.g., two 需求分析 tabs) **share the same output file** (需求分析.md) but contribute to it from separate conversations — like two analysts working on the same whiteboard.
- **File tree** — project-level, shared across all work records and tabs; user clicks to load files into agent context
- **Agent context panel** — shows which md files the agent currently has loaded; user can add/remove
- **File changelog** — each md file has a header tracking requirement count, iteration #, etc. so AI reads it coherently
- **Progress indicator** — non-blocking, shows current phase (see Navigation mode)

| Tech stack | Next.js + MongoDB (Mongoose) + NextAuth.js + OpenAI SDK + Tailwind CSS, local dev | AI API 使用 OpenAI 兼容的 Chat Completions 格式；本地测试默认不消耗 API |
| Authentication | Email + password (NextAuth.js Credentials, bcrypt, JWT) | Simple, no external auth dependency |
| File tree | Included in MVP — click to load file into agent context; drag to v2 | Core handoff visual; demonstrates the key differentiator |
| MVP pages | ① Register ② Login ③ Project list ④ Session list ⑤ Workspace | 5 routes; standard web app structure |
| 工作记录命名 | 创建时可选填名称（留空为「未命名」）；改名入口 = 列表页行内按钮 + 工作区顶栏点击；AI 自动命名保留，仅对「未命名」生效，用户手动起名后不再覆盖 | v1.1 决策（2026-08-11）：用户要能自己起名，AI 命名降级为兜底 |
| Tab naming | Auto: "Agent类型 #N", user can double-click to rename | Defaults sensible, flexibility available |
| Empty states | ① Project list: "创建第一个项目" CTA ② Work record list: "新建工作记录" CTA ③ Workspace (no tabs): 四步流水线全景 + 仅「需求分析」可点，后三步锁定（v1.1，见「空状态引导」行）④ File tree (no files): explain files appear after agent interaction ⑤ Chat area: no proactive greeting, let user start | First 4 are UI states; agent stays quiet until spoken to |
| User flow (happy path) | Register → Create project → Create session → Chat with 需求分析 Agent (grilling → 需求分析.md) → 原型 Agent tab (提案 + 可视化确认 → 原型.md) → PRD Agent tab (嵌入原型 → 确认 → prd.md) → 任务拆分 Agent tab (quiz → issues/) | Four-agent pipeline, validates the whole flow |

## Deferred to implement phase

- Agent system prompts and grilling protocols (exact wording belongs to implementation)
- UI component tree and exact layout
- Database schema (table structure)
- Drag-to-load file UX (v2)
