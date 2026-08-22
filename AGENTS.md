## Agent skills

### Issue tracker

Issues live as markdown files under `.scratch/<feature-slug>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Uses the five canonical triage labels from mattpocock/skills. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout — one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Implement context

Every `/implement` session must read `docs/agents/implement-context-hygiene.md` before doing anything else — it exists to keep the context window from being wasted on irrelevant files.

### Ticket model routing

Every `/to-tickets` session must read `docs/agents/ticket-model-routing.md` and, after the user approves the final ticket split, generate `.scratch/<feature-slug>/model-routing.md` for the human to choose an implement model. The file must cover every generated ticket with a risk level, primary model, evidence-based reason, verification method, and escalation condition.

Every `/implement` session for a newly ticketed feature must read that feature's `model-routing.md` after `implement-context-hygiene.md` and before the current ticket. Treat it as an advisory routing table: obey an explicit user model choice, start with the primary model, and escalate when the documented condition or a shared-protocol/cross-module failure occurs. Do not treat the routing file as a second product specification.

## 改动风险分级与验证策略

改动按风险分级，验证成本与风险匹配。项目本地验证默认使用 `AI_MODE=replay` 固定回放，不调用真实模型；只有确实需要验证 prompt 与模型行为时，才显式使用 `AI_MODE=live`。

### 分级

- **L0 低风险**：参数/常量/文案，无行为语义变更。验证 = tsc + 必要时一次针对性检查；不调用真实模型。
- **L1 中风险**：单层逻辑改动，不触及协议标记/验证断言/存储数据。验证 = tsc + 一次最轻量的离线回放检查。
- **L2 高风险**：协议/断言/跨 Agent 共享逻辑。验证 = 相关回放 verify 脚本完整跑；只有需要确认模型遵守新 prompt 时，才额外安排一次真实模型冒烟。

### 配套规则

1. **批量收集**：同一范围内的多个改动（如「原型 Agent 的 N 个问题」）先攒齐再统一验证，禁止改一个验一个。
2. **真实验证先报备**：任何 `AI_MODE=live` 验证都必须先说明验证假设、预计轮数和 token 成本，并获得用户同意；单个功能默认最多一次真实对话，完整四环真实回归默认最多一次。
3. **被问即汇报，不许说「还在跑」**：用户询问进度或怀疑卡住时，必须主动声明：①为什么跑了这么久 ②是否必要继续 ③再下去要多久才能拿到结果——让用户决定继续还是止损，禁止只确认状态后敷衍。
4. **回放优先**：UI、SSE、marker、确认框、冻结状态、文件写入和数据库断言使用固定回放验证；真实模型验证不重复覆盖这些内容。
5. **完整回归去重**：同一次改动已完成四环真实回归后，不再重复运行各 Agent 的独立真实回归脚本。
6. **用户流程提醒当场生效**：用户对流程的质疑/提醒是约束，立即改变行为，不口头承认后照旧。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
