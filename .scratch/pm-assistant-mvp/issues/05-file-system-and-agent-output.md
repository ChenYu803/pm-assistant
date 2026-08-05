# 05 — 文件系统 + Agent 产出文件

**What to build:** 项目文件树（左侧面板）。Agent 产出的 md 内容 → 前端解析标记 → 弹出确认对话框 → 用户确认 → 写入文件。文件预览、变更日志头、在线编辑、下载。

**Blocked by:** 04 — 需要 Agent 对话流中产出 `%%%FILE_BEGIN%%%` 标记。

**Status:** ready-for-agent

- [ ] ProjectFile model：filename, content, changelog (embedded: requirement_count, iteration, last_editor, timestamp), project_id (ref)
- [ ] AgentFileContext model：tab_id (ref), file_id (ref) — 记录标签页加载了哪些文件
- [ ] `GET /api/projects/:id/files` — 列出项目文件
- [ ] `GET /api/projects/:id/files/:id` — 获取文件内容
- [ ] `PATCH /api/projects/:id/files/:id` — 更新文件（用户手动编辑保存）
- [ ] `GET /api/projects/:id/files/:id/download` — 下载文件为 .md
- [ ] `POST /api/projects/:id/files` — Agent 写入文件（内部调用，写文件 + 更新 changelog）
- [ ] 文件树组件：项目所有 md 文件列表，显示文件名 + 最近更新时间。空状态：提示"与 Agent 对话产出第一份文档"
- [ ] 文件预览：点击文件 → 右侧/弹出面板渲染 markdown 预览
- [ ] Agent 产出确认对话框：聊天流中出现 `%%%FILE_BEGIN%%%` 标记 → 前端截获 → 弹出对话框展示 Markdown 渲染预览 + "确认写入" / "取消"按钮 → 确认后调 API 写入
- [ ] 文件变更日志：每次 Agent 写入自动追加 requirement_count + iteration 行到文件头。用户手动编辑时不更新 changelog（等 AI 润色时更新）
- [ ] 文件下载：文件预览面板中的下载按钮
- [ ] 在线编辑：文件预览面板中"编辑"按钮 → modal 打开 markdown 文本编辑器 → 保存 → 调 PATCH 接口
