# 06 — MVP-PRD Agent + Handoff

**What to build:** 用户新建 MVP-PRD Agent 标签页 → 系统自动加载需求分析.md 到 Agent 上下文 → Agent 在对话中进行三视角二次确认 → 产出精简版 PRD → 范围冻结确认 → 落地版五个维度详述 → 写入 prd.md。

**Blocked by:** 05 — 需要文件系统支持自动加载和 Agent 写入。

**Status:** resolved

- [x] MVP-PRD Agent SystemPrompt（v1 初始版）：定义角色为"MVP 产品需求文档撰写专家"。流程：① 阅读已加载的需求分析.md → ② 三视角（用户/商业/技术）逐条二次确认 → ③ 输出精简版 PRD（≤300 字概念版）→ ④ 范围冻结确认（明确征求用户"以上范围确认后不可改"）→ ⑤ 用户确认后进入落地版 → ⑥ 每个 MVP 功能按五个维度详述（用户流程/状态机/字段规范/文案规范/异常处理）→ ⑦ 写入 prd.md
- [x] 新建 MVP-PRD Agent 标签页时：后端自动查询该项目的需求分析.md，若存在则创建 AgentFileContext 关联（自动加载）
- [x] PRD Agent 对话流：SystemPrompt + 自动加载的文件内容 + 历史消息 + 用户消息 → LLM 流式返回
- [x] 精简版 PRD 产出格式：三视角二次确认总结 + 概念版 PRD（核心用户、要解决的一件事、产品形态、MVP 功能 ≤3 个、本版本不做什么、商业模式、技术前提）+ "以上范围是否确认？确认后进入落地版详细撰写"
- [x] 落地版 PRD 产出格式：概述（背景/目标/范围）→ 功能列表（优先级排序）→ 每个功能五个维度详述 → 明确不做的事 → 变更日志
- [x] 范围冻结逻辑：Agent 必须在对话中得到用户明确肯定（"确认" / "可以" / "没问题"等），才能继续写入落地版内容
- [x] 文件写入：通过 `%%%FILE_BEGIN%%%` / `%%%FILE_END%%%` 标记，写入 prd.md（与 Ticket 5 确认对话框复用）

## Comments

完成日期：2026-08-05

实现细节：
- MVP_PRD_PROMPT 扩展为完整六步流程（`src/lib/agent-prompts.ts`），包含精简版 PRD 模板、范围冻结标记（%%%SCOPE_FROZEN%%%）、落地版五维度详述规范
- Tab 模型新增 `scope_frozen` 字段（`src/models/Tab.ts`），默认为 false
- 创建 MVP-PRD 标签页时自动加载需求分析.md（`src/app/api/work-records/[id]/tabs/route.ts`），通过 AgentFileContext 关联
- Chat 路由注入已加载文件内容到 SystemPrompt（`src/app/api/tabs/[id]/chat/route.ts`），自动剥离 changelog 头
- Chat 路由检测 %%%SCOPE_FROZEN%%% 标记后设置 tab.scope_frozen = true，后续对话注入范围冻结提醒
- 管线进度指示器（PipelineProgressIndicator）在工作台顶栏显示当前阶段和冻结状态
- GET API 返回新响应格式 `{ tab, context_files }`，前端兼容处理
