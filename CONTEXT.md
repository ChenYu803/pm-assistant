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
| Agent design | Each agent has a baked-in system prompt for its specific role | User never writes "you are a PM" — they just describe their situation |
| AI backend | Wraps existing LLM APIs (e.g. Claude API) with custom system prompts and tools | Analogous to Claude Code's productization pattern |
| MVP agents | ① 需求分析 Agent — Requirement Analyst ② MVP-PRD Agent — MVP Scope & PRD Writer | Two agents; validates both specialization AND handoff |
| 需求分析.md format | List of requirements, each with 4-section analysis (用户与场景 / 用户故事 / 功能范围 / 成功指标). Agent fills it autonomously from grilling context | Agent is gatekeeper, not scribe — only validated requirements enter the list |
| File editing | User can edit any file inline; AI polishes to proper md format afterward | User has final say over content |
| prd.md format | Two-part: 精简版 (三视角二次确认 + 概念版PRD ≤300字 + 范围冻结) → 落地版 (五个维度详述每个功能: 用户流程/状态机/字段规范/文案规范/异常处理) | PRD Agent二次确认需求分析的结论，不重新讨论；落地版可直接vibe coding |

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

| Tech stack | Next.js + MongoDB (Mongoose) + NextAuth.js + Vercel AI SDK + shadcn/ui, local dev | Local deployment for fast iteration |
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
