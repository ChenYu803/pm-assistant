# 05 — 文件系统 + Agent 产出文件

**What to build:** 项目文件树（左侧面板）。Agent 产出的 md 内容 → 前端解析标记 → 弹出确认对话框 → 用户确认 → 写入文件。文件预览、变更日志头、在线编辑、下载。

**Blocked by:** 04 — 需要 Agent 对话流中产出 `%%%FILE_BEGIN%%%` 标记。

**Status:** resolved

- [x] ProjectFile model：filename, content, changelog (embedded: requirement_count, iteration, last_editor, timestamp), project_id (ref)
- [x] AgentFileContext model：tab_id (ref), file_id (ref) — 记录标签页加载了哪些文件
- [x] `GET /api/projects/:id/files` — 列出项目文件
- [x] `GET /api/projects/:id/files/:id` — 获取文件内容
- [x] `PATCH /api/projects/:id/files/:id` — 更新文件（用户手动编辑保存）
- [x] `GET /api/projects/:id/files/:id/download` — 下载文件为 .md
- [x] `POST /api/projects/:id/files` — Agent 写入文件（内部调用，写文件 + 更新 changelog）
- [x] 文件树组件：项目所有 md 文件列表，显示文件名 + 最近更新时间。空状态：提示"与 Agent 对话产出第一份文档"
- [x] 文件预览：点击文件 → 右侧面板渲染 markdown 预览
- [x] Agent 产出确认对话框：聊天流中出现 `%%%FILE_BEGIN%%%` 标记 → 前端截获 → 弹出对话框展示 Markdown 渲染预览 + "确认写入" / "取消"按钮 → 确认后调 API 写入
- [x] 文件变更日志：每次 Agent 写入自动追加 requirement_count + iteration 行到文件头。用户手动编辑时不更新 changelog（等 AI 润色时更新）
- [x] 文件下载：文件预览面板中的下载按钮
- [x] 在线编辑：文件预览面板中"编辑"按钮 → modal 打开 markdown 文本编辑器 → 保存 → 调 PATCH 接口

## Comments

完成日期：2026-08-05

实现细节：
- ProjectFile model 位于 `src/models/ProjectFile.ts`，包含 changelog 解析/格式化/头剥离/需求计数工具函数
- AgentFileContext model 位于 `src/models/AgentFileContext.ts`，唯一索引 (tab_id, file_id)
- 文件 API 全路径实现：列表（不含 content）、详情（含 content）、PATCH（用户编辑，不改 changelog）、POST（Agent 写入，自动更新 changelog）、下载（Content-Disposition attachment）
- FileTree 组件 `src/components/FileTree.tsx`：纯展示组件，显示文件名 + 相对时间，空状态引导文案
- FilePreviewPanel 组件 `src/components/FilePreviewPanel.tsx`：右侧 384px 面板，Markdown 渲染预览，编辑/下载/关闭按钮
- FileConfirmDialog 组件 `src/components/FileConfirmDialog.tsx`：modal 弹窗展示 Agent 产出的文件内容预览，确认/取消按钮
- FileEditorModal 组件 `src/components/FileEditorModal.tsx`：modal 打开 textarea 编辑器，monospace 字体，保存后调用 PATCH 接口
- MarkdownRenderer 组件 `src/components/MarkdownRenderer.tsx`：轻量级 markdown → HTML 渲染器，支持标题/粗体/斜体/代码/列表/引用/链接/删除线，自动剥离 changelog 头
- 文件标记正则：`/%%%FILE_BEGIN%%%\s*(.+?\.md)\s*\n([\s\S]*?)%%%FILE_END%%%/g`，ChatArea 解析后弹出确认对话框
- 变更日志格式：markdown 注释块（`<!-- changelog: ... -->`），Agent 每次写入自动递增 iteration
