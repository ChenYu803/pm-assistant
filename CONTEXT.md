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
| Target workflow | 需求收集 → 需求分析 → PRD撰写/迭代 (原型制作 deferred to v2) | Three-phase v1 pipeline |
| Navigation mode | Hybrid — light progress indicator shows current phase, but user is never locked; skip/back/jump-in always allowed | Guides novices without constraining experienced users |
| v1 priority | Process efficiency ("B") to 90 points; agent output quality ("A") as baseline; history ("C") limited | Flow is the moat; prompt quality can improve incrementally |
| 目标用户群 | **求职 PM**（无 PM 工作经验的求职者；产品作者本人即典型用户）。原「在职 PM」定位作废（见 ADR-0001） | Dogfooding 兼作简历叙事；MVP 已验证流水线概念，v1.0 验证「新人也走得通」 |
| 增长策略（三步走） | ① 自己作为唯一用户，把产品打磨成「自己想要的样子」 ② 以教学之名经营小红书等社群，引流其他求职 PM 使用 ③ 未来随用户群成长回在职 PM 市场 | 先做深单点再扩张；教学是引流手段，产品价值是「从想法到 PRD 的完整产出」 |
| 核心体验目标 | 新人无引导也能走完「想法 → 需求分析.md → prd.md」并导出成果 | 求职 PM 不懂 PM 流程，产品必须自己教会他们；需模板案例、新手引导、成果导出支撑 |
| Agent design | Each agent has a baked-in system prompt for its specific role | User never writes "you are a PM" — they just describe their situation |
| AI backend | DeepSeek API (`deepseek-chat`) via OpenAI-compatible SDK | 成本最低的选择；DeepSeek V3 在中文 PM 场景下表现优秀 |
| MVP agents | ① 需求分析 Agent — Requirement Analyst ② MVP-PRD Agent — MVP Scope & PRD Writer | Two agents; validates both specialization AND handoff |
| 需求分析.md format | List of requirements, each with 4-section analysis (用户与场景 / 用户故事 / 功能范围 / 成功指标). Agent fills it autonomously from grilling context | Agent is gatekeeper, not scribe — only validated requirements enter the list |
| File editing | User can edit any file inline; AI polishes to proper md format afterward | User has final say over content |
| prd.md format | Two-part: 精简版 (三视角二次确认 + 概念版PRD ≤300字 + 范围冻结) → 落地版 (五个维度详述每个功能: 用户流程/状态机/字段规范/文案规范/异常处理) | PRD Agent二次确认需求分析的结论，不重新讨论；落地版可直接vibe coding |
| PRD 的读者 | **AI**（「只会执行的程序员」）——「直接拿去 vibe coding」是字面要求，不是「稍作补充」 | v1.0 定稿（见 ADR-0002）；现有五维度结构对人友好、对 AI 太粗犷，v1.0 将重构 PRD 结构 |
| v1.0 完成标志 | 作者本人（唯一用户）从零走完「想法 → 需求分析.md → prd.md」，拿到的 PRD 实际 vibe coding 一次跑通 | Dogfooding 兼作验收：PRD 质量是产品唯一北极星，一切 Agent 均为 PRD 撰写/更新服务 |
| v1.0 工作方式 | 「AI 执行版 PRD 骨架设计」是独立 issue（`.scratch/pm-assistant-v1/issues/01-prd-ai-execution-skeleton.md`），需要一个空旷的上下文窗口专门讨论——大设计问题不在 grilling 会话中挤决策 | 该问题巨大且重要，挤在对话里只会得到残缺决策（2026-08-06 grilling 确认） |

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
    └── prd.md (changelog: version, iteration #)
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
| User flow (happy path) | Register → Create project → Create session → Chat with 需求分析 Agent (grilling → write 需求分析.md) → Open PRD Agent tab (auto-loads 需求分析.md → confirm → write prd.md) | Two-agent pipeline, validated in one session |

## Deferred to implement phase

- Agent system prompts and grilling protocols (exact wording belongs to implementation)
- UI component tree and exact layout
- Database schema (table structure)
- Drag-to-load file UX (v2)
