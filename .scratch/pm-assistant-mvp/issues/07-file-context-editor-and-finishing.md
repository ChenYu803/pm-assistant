# 07 — 文件上下文管理 + 在线编辑 + 收尾

**What to build:** Agent 上下文面板（显示已加载文件，可加载/移除）。在线 markdown 编辑后 AI 润色。流水线进度指示器。LLM 错误重试。产物质量打磨。

**Blocked by:** 04 — 需要聊天功能加载文件上下文。05 — 需要文件系统支持上下文关联和在线编辑。

**Status:** ready-for-agent

- [ ] `POST /api/tabs/:id/files` — 加载文件到 Agent 上下文（创建 AgentFileContext）
- [ ] `DELETE /api/tabs/:id/files/:fileId` — 从 Agent 上下文移除文件
- [ ] `GET /api/tabs/:id/files` — 获取当前 Agent 已加载的文件列表
- [ ] Agent 上下文面板 UI：当前标签页已加载的文件列表（文件名 + 移除按钮）。加载文件：从文件树中点击文件 → 提示加载到当前 Agent。面板显示"当前 Agent 已加载的文件"
- [ ] 在线编辑 AI 润色：用户在线编辑保存后 → 调用轻量 AI 润色为规范 md → 返回润色后内容 → 用户确认 → 写入
- [ ] 流水线进度指示器（非阻塞）：工作台顶部显示"需求分析"和"PRD 撰写"两个阶段，当前阶段高亮。仅视觉提示，不锁定导航
- [x] LLM 错误处理：对话中 API 超时/失败 → 显示错误提示 + "重试"按钮。重试重发最后一条用户消息
- [ ] 文件树右键菜单（或内嵌操作按钮）：预览、加载到当前 Agent、在线编辑、下载
- [ ] 视觉打磨：shadcn/ui 组件一致化、间距统一、颜色协调
- [ ] 端到端验证：走通 happy path（注册 → 创建项目 → 创建记录 → 需求分析 → 产出需求分析.md → PRD Agent 自动加载 → 产出 prd.md）

## Comments

2026-08-05 状态更新：
- AgentFileContext model 已在 Ticket 5 中创建（`src/models/AgentFileContext.ts`），但上下文管理的 API 路由（POST/GET/DELETE `/api/tabs/:id/files`）尚未实现
- Chat API 的路由级错误处理已实现（SSE 流中断时保存部分内容 + 返回错误事件），前端 ChatArea 显示错误横幅但尚未实现"重试"功能（重发最后一条用户消息的逻辑待添加）
- 在线编辑基础设施已完成（FileEditorModal + PATCH 接口），但 AI 润色功能尚未实现
- 文件树右键菜单、Agent 上下文面板 UI、流水线进度指示器、视觉打磨、端到端验证均未开始
