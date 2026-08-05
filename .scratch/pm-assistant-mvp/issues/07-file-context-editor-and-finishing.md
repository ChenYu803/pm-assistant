# 07 — 文件上下文管理 + 在线编辑 + 收尾

**What to build:** Agent 上下文面板（显示已加载文件，可加载/移除）。在线 markdown 编辑后 AI 润色。流水线进度指示器。LLM 错误重试。产物质量打磨。

**Blocked by:** 04 — 需要聊天功能加载文件上下文。05 — 需要文件系统支持上下文关联和在线编辑。

**Status:** resolved

- [x] `POST /api/tabs/:id/files` — 加载文件到 Agent 上下文（创建 AgentFileContext）
- [x] `DELETE /api/tabs/:id/files/:fileId` — 从 Agent 上下文移除文件
- [x] `GET /api/tabs/:id/files` — 获取当前 Agent 已加载的文件列表
- [x] Agent 上下文面板 UI：当前标签页已加载的文件列表（文件名 + 移除按钮）。加载文件：从文件树中点击文件 → 提示加载到当前 Agent。面板显示"当前 Agent 已加载的文件"
- [x] 在线编辑 AI 润色：用户在线编辑保存后 → 调用轻量 AI 润色为规范 md → 返回润色后内容 → 用户确认 → 写入
- [x] 流水线进度指示器（非阻塞）：工作台顶部显示"需求分析"和"PRD 撰写"两个阶段，当前阶段高亮。仅视觉提示，不锁定导航
- [x] LLM 错误处理：对话中 API 超时/失败 → 显示错误提示 + "重试"按钮。重试重发最后一条用户消息
- [x] 文件树右键菜单（或内嵌操作按钮）：预览、加载到当前 Agent、在线编辑、下载
- [x] 视觉打磨：shadcn/ui 组件一致化、间距统一、颜色协调
- [x] 端到端验证：走通 happy path（注册 → 创建项目 → 创建记录 → 需求分析 → 产出需求分析.md → PRD Agent 自动加载 → 产出 prd.md）

## Comments

完成日期：2026-08-05

实现细节：
- 三个 API 路由：`src/app/api/tabs/[id]/files/route.ts`（GET 列表 + POST 加载，含重复检测 409）、`src/app/api/tabs/[id]/files/[fileId]/route.ts`（DELETE 移除）
- AI 润色 API：`src/app/api/projects/[id]/files/[fileId]/polish/route.ts`（非流式调用 DeepSeek，返回润色后内容）
- AgentContextPanel 组件（`src/components/AgentContextPanel.tsx`）：可折叠面板，显示已加载文件 + hover 移除按钮
- PipelineProgressIndicator 组件（`src/components/PipelineProgressIndicator.tsx`）：两阶段圆点指示器，当前阶段 indigo 高亮，范围冻结显示 🔒
- FileTree 新增 hover 操作按钮（加载到 Agent / 编辑 / 下载），匹配 TabBar 的 group-hover 模式
- ChatArea 重构发送逻辑：提取 sendContent 核心函数，sendMessage 和 handleRetry 共用；错误横幅新增"重试"按钮
- FileEditorModal 新增"AI 润色"按钮：调用 polish API → 展示润色预览 → "应用润色"/"保留原文"
- 工作台页面集成所有新组件：PipelineProgressIndicator 在顶栏、AgentContextPanel 在文件树右侧、FileTree 传入操作 handler

视觉打磨：
- 通过 `impeccable detect` 扫描全部组件，清零设计反模式
- 3 个 gray-on-color 误报已通过 `.impeccable/config.json` 排除（均为 hover 态下文字颜色被正确覆盖的场景）

E2E 验证（2026-08-05）：
- 完整走通 happy path：注册 → 创建项目 → 创建记录 → 需求分析对话 → 产出需求分析.md → MVP-PRD 标签页自动加载 → 范围冻结 → 产出 prd.md → 文件预览/编辑/润色/下载
- 发现并修复问题：服务端/客户端边界拆分、文件列表不含 content 导致预览崩溃、max_tokens 不足截断 PRD 输出
