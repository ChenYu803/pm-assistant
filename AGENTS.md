## Agent skills

### Issue tracker

Issues live as markdown files under `.scratch/<feature-slug>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Uses the five canonical triage labels from mattpocock/skills. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout — one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Implement context

Every `/implement` session must read `docs/agents/implement-context-hygiene.md` before doing anything else — it exists to keep the context window from being wasted on irrelevant files.

## 改动风险分级与验证策略

改动按风险分级，验证成本与风险匹配。**LLM 对话级验证（单次 15-30 分钟）只留给高风险改动**——禁止机械执行「修复后必跑 verify 脚本」。判级先于动手：改动属于哪级，决定验证怎么做。

### 分级

- **L0 低风险**：参数/常量/文案，无行为语义变更（如 max_tokens、超时数值、模型名、UI 文案）。验证 = tsc 编译 + 必要时一次针对性实测（如 curl 探测 API 参数）。**不跑 LLM 端到端脚本**。
- **L1 中风险**：单层逻辑改动，不触及协议标记/验证断言/存储数据（如前端渲染路径、单函数修正、配套等待参数）。验证 = tsc + 一次最轻量的相关检查；要跑脚本先报备。
- **L2 高风险**：协议/断言/跨 Agent 共享逻辑（如 marker 协议、冻结执法、verify 断言、文件写入格式）。验证 = 相关 verify 脚本完整跑 + 按需回归相邻脚本。

### 配套规则

1. **批量收集**：同一范围内的多个改动（如「原型 Agent 的 N 个问题」）先攒齐再统一验证，禁止改一个验一个。
2. **长验证先报备**：预计超过 10 分钟的验证（LLM 对话级）必须先告知预计时长和理由，用户同意才跑。
3. **被问即汇报，不许说「还在跑」**：用户询问进度或怀疑卡住时，必须主动声明：①为什么跑了这么久 ②是否必要继续 ③再下去要多久才能拿到结果——让用户决定继续还是止损，禁止只确认状态后敷衍。
4. **用户流程提醒当场生效**：用户对流程的质疑/提醒是约束，立即改变行为，不口头承认后照旧。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
