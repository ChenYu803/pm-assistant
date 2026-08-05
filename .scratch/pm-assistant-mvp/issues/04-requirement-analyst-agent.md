# 04 — 需求分析 Agent + 流式对话

**What to build:** 聊天区组件。用户选择"需求分析 Agent"后发送消息 → Agent 流式回复（SSE）。Agent 注入预置 SystemPrompt（含诘问流程），对话持久化。工作记录名称在首轮对话后由 AI 自动生成。

**Blocked by:** 03 — 需要标签页承载对话界面。

**Status:** ready-for-agent

- [ ] `POST /api/tabs/:id/chat` — 发送消息给 Agent，返回 SSE 流。逻辑：取 SystemPrompt + 历史消息（当前 tab）+ 用户新消息 → 拼接 prompt → 调用 Anthropic API (Messages API, streaming) → 逐 token 返回
- [ ] `GET /api/tabs/:id/messages` — 获取标签页的所有历史消息
- [ ] 需求分析 Agent SystemPrompt（v1 初始版）：定义角色为"资深产品需求分析师"，四阶段诘问流程（场景破冰 → 痛点深挖 → 方案收敛 → 四段确认写入），明确"必须经过用户确认才能产出文件"，规定需求分析.md 输出格式
- [ ] 聊天区组件：消息气泡（用户/AI 区分样式），流式逐字显示（useChat hook 或手动 SSE 消费），自动滚动到底部
- [ ] 输入框 + 发送按钮，支持 Enter 发送
- [ ] 流式对话过程中显示"正在思考..."指示器
- [ ] 消息持久化：每条消息发送后存入 MongoDB Messages 集合，刷新页面后恢复历史
- [ ] 工作记录名称自动生成：首轮对话完成后（3 条消息以上），用一次轻量 AI 调用基于对话摘要生成名称 → 更新 WorkRecord.name
- [ ] Agent 产出文件前的确认交互留到 Ticket 5（文件系统），此处 Agent 只需在回复中用 `%%%FILE_BEGIN%%%` / `%%%FILE_END%%%` 标记产出内容
