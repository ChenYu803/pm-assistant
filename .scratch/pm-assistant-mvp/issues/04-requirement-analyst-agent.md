# 04 — 需求分析 Agent + 流式对话

**What to build:** 聊天区组件。用户选择"需求分析 Agent"后发送消息 → Agent 流式回复（SSE）。Agent 注入预置 SystemPrompt（含诘问流程），对话持久化。工作记录名称在首轮对话后由 AI 自动生成。

**Blocked by:** 03 — 需要标签页承载对话界面。

**Status:** resolved

- [x] `POST /api/tabs/:id/chat` — 发送消息给 Agent，返回 SSE 流。逻辑：取 SystemPrompt + 历史消息（当前 tab）+ 用户新消息 → 拼接 prompt → 调用 DeepSeek API (OpenAI SDK, streaming) → 逐 token 返回
- [x] `GET /api/tabs/:id/messages` — 获取标签页的所有历史消息
- [x] 需求分析 Agent SystemPrompt（v1 初始版）：定义角色为"资深产品需求分析师"，四阶段诘问流程（场景破冰 → 痛点深挖 → 方案收敛 → 四段确认写入），明确"必须经过用户确认才能产出文件"，规定需求分析.md 输出格式
- [x] 聊天区组件：消息气泡（用户/AI 区分样式），流式逐字显示（手动 SSE 消费），自动滚动到底部
- [x] 输入框 + 发送按钮，支持 Enter 发送
- [x] 流式对话过程中显示"正在思考..."指示器（三个弹跳圆点动画）
- [x] 消息持久化：每条消息发送后存入 MongoDB Messages 集合，刷新页面后恢复历史
- [x] 工作记录名称自动生成：首轮对话完成后（3 条消息以上），用一次轻量 AI 调用基于对话摘要生成名称 → 更新 WorkRecord.name
- [x] Agent 产出文件前的确认交互留到 Ticket 5（文件系统），此处 Agent 只需在回复中用 `%%%FILE_BEGIN%%%` / `%%%FILE_END%%%` 标记产出内容

## Comments

完成日期：2026-08-05

实现细节：
- Chat API 位于 `src/app/api/tabs/[id]/chat/route.ts`，使用 DeepSeek API（deepseek-chat 模型）流式输出
- 流式响应使用 SSE 格式（`data: {"type":"token","content":"..."}\n\n`），前端 ChatArea 手动解析 SSE
- SystemPrompt 位于 `src/lib/agent-prompts.ts`，包含完整的四阶段诘问流程定义
- 需求分析 Agent 产出的文件标记为 `%%%FILE_BEGIN%%% 需求分析.md` ... `%%%FILE_END%%%`
- ChatArea 组件 `src/components/ChatArea.tsx` 实现：消息气泡、流式渲染、自动滚动、"正在思考"指示器
- 错误处理：SSE 流中断时保存已接收的部分内容，超时/失败显示友好错误提示
- 自动命名位于 `src/lib/auto-name.ts`：消息数≥3 且名为"未命名"时触发，使用 DeepSeek 生成 ≤20 字名称
- MVP-PRD Agent 的 SystemPrompt 也已写入 agent-prompts.ts，共享相同的 SSE 对话基础设施
