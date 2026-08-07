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
| v1 priority | Process efficiency ("B") to 90 points; agent output quality ("A") as baseline; history ("C") limited | Flow is the moat; prompt quality can improve incrementally |
| 目标用户群 | **求职 PM**（无 PM 工作经验的求职者；产品作者本人即典型用户）。原「在职 PM」定位作废（见 ADR-0001） | Dogfooding 兼作简历叙事；MVP 已验证流水线概念，v1.0 验证「新人也走得通」 |
| 增长策略（三步走） | ① 自己作为唯一用户，把产品打磨成「自己想要的样子」 ② 以教学之名经营小红书等社群，引流其他求职 PM 使用 ③ 未来随用户群成长回在职 PM 市场 | 先做深单点再扩张；教学是引流手段，产品价值是「从想法到 PRD 的完整产出」 |
| 核心体验目标 | 新人无引导也能走完「想法 → 需求分析.md → 原型.md → prd.md → issues」并导出成果 | 求职 PM 不懂 PM 流程，产品必须自己教会他们；需模板案例、新手引导、成果导出支撑 |
| Agent design | Each agent has a baked-in system prompt for its specific role | User never writes "you are a PM" — they just describe their situation |
| AI backend | DeepSeek API (`deepseek-chat`) via OpenAI-compatible SDK | 成本最低的选择；DeepSeek V3 在中文 PM 场景下表现优秀 |
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

| Tech stack | Next.js + MongoDB (Mongoose) + NextAuth.js + OpenAI SDK (DeepSeek API) + Tailwind CSS, local dev | Local deployment for fast iteration |
| Authentication | Email + password (NextAuth.js Credentials, bcrypt, JWT) | Simple, no external auth dependency |
| File tree | Included in MVP — click to load file into agent context; drag to v2 | Core handoff visual; demonstrates the key differentiator |
| MVP pages | ① Register ② Login ③ Project list ④ Session list ⑤ Workspace | 5 routes; standard web app structure |
| Session naming | AI auto-generates name from first conversation turn | User doesn't need to think about it |
| Tab naming | Auto: "Agent类型 #N", user can double-click to rename | Defaults sensible, flexibility available |
| Empty states | ① Project list: "创建第一个项目" CTA ② Work record list: "新建工作记录" CTA ③ Workspace (no tabs): prompt to create a tab, list agent types ④ File tree (no files): explain files appear after agent interaction ⑤ Chat area: no proactive greeting, let user start | First 4 are UI states; agent stays quiet until spoken to |
| User flow (happy path) | Register → Create project → Create session → Chat with 需求分析 Agent (grilling → 需求分析.md) → 原型 Agent tab (提案 + 可视化确认 → 原型.md) → PRD Agent tab (嵌入原型 → 确认 → prd.md) → 任务拆分 Agent tab (quiz → issues/) | Four-agent pipeline, validates the whole flow |

## Deferred to implement phase

- Agent system prompts and grilling protocols (exact wording belongs to implementation)
- UI component tree and exact layout
- Database schema (table structure)
- Drag-to-load file UX (v2)
