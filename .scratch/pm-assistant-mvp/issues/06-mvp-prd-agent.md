# 06 — MVP-PRD Agent + Handoff

**What to build:** 用户新建 MVP-PRD Agent 标签页 → 系统自动加载需求分析.md 到 Agent 上下文 → Agent 在对话中进行三视角二次确认 → 产出精简版 PRD → 范围冻结确认 → 落地版五个维度详述 → 写入 prd.md。

**Blocked by:** 05 — 需要文件系统支持自动加载和 Agent 写入。

**Status:** ready-for-agent

- [x] MVP-PRD Agent SystemPrompt（v1 初始版）：定义角色为"MVP 产品需求文档撰写专家"。流程：① 阅读已加载的需求分析.md → ② 三视角（用户/商业/技术）逐条二次确认 → ③ 输出精简版 PRD（≤300 字概念版）→ ④ 范围冻结确认（明确征求用户"以上范围确认后不可改"）→ ⑤ 用户确认后进入落地版 → ⑥ 每个 MVP 功能按五个维度详述（用户流程/状态机/字段规范/文案规范/异常处理）→ ⑦ 写入 prd.md
- [ ] 新建 MVP-PRD Agent 标签页时：后端自动查询该项目的需求分析.md，若存在则创建 AgentFileContext 关联（自动加载）
- [x] PRD Agent 对话流：SystemPrompt + 自动加载的文件内容 + 历史消息 + 用户消息 → LLM 流式返回
- [ ] 精简版 PRD 产出格式：三视角二次确认总结 + 概念版 PRD（核心用户、要解决的一件事、产品形态、MVP 功能 ≤3 个、本版本不做什么、商业模式、技术前提）+ "以上范围是否确认？确认后进入落地版详细撰写"
- [ ] 落地版 PRD 产出格式：概述（背景/目标/范围）→ 功能列表（优先级排序）→ 每个功能五个维度详述 → 明确不做的事 → 变更日志
- [ ] 范围冻结逻辑：Agent 必须在对话中得到用户明确肯定（"确认" / "可以" / "没问题"等），才能继续写入落地版内容
- [x] 文件写入：通过 `%%%FILE_BEGIN%%%` / `%%%FILE_END%%%` 标记，写入 prd.md（与 Ticket 5 确认对话框复用）

## Comments

2026-08-05 状态更新：
- SystemPrompt v1 已写入 `src/lib/agent-prompts.ts`，但标注了"完整的 PRD 模板将在后续迭代中细化"
- 对话基础设施（SSE 流式、消息持久化、文件标记解析）由 Ticket 4/5 完成，PRD Agent 可直接复用
- **待实现**：新建 MVP-PRD 标签页时自动加载需求分析.md 的后端逻辑（需修改 `POST /api/work-records/:id/tabs`）
- **待实现**：范围冻结确认逻辑（需要对话级状态跟踪，可能需在 Tab 模型中添加 `freeze_status` 字段）
- **待实现**：精简版/落地版 PRD 的完整 SystemPrompt 模板细化
