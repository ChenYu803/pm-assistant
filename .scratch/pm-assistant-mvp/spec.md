# PM Assistant MVP — Spec

## Problem Statement

产品经理的工作流（需求收集 → 需求分析 → PRD 撰写）目前依赖通用 AI 聊天工具（ChatGPT、Claude 等）。这带来三个问题：

1. **上下文膨胀**：把整个工作流塞进一次对话，上下文越长质量越低。
2. **重复劳动**：每次新对话都要重新解释背景、重新写 prompt，无法复用之前的产出。
3. **缺乏专业化**：通用助手靠用户写"你是资深产品经理"来激活——prompt 质量全靠用户水平。

PM Assistant 解决这个问题的核心理念：**把 PM 工作流拆成专业化 Agent 流水线，以 md 文件为交接物，每个 Agent 专注一个环节。**

## Solution

一个网站，用户在其中创建**项目**，在每个项目下创建**工作记录**，在工作记录中通过**标签页**与不同专业 Agent 对话。每个 Agent 有预置的 SystemPrompt，用户无需手写 prompt。Agent 之间的工作成果以 md 文件形式在项目文件树中流转。

MVP 包含两个 Agent：
- **需求分析 Agent**：诘问用户 → 产出需求分析.md
- **MVP-PRD Agent**：二次确认需求分析结论 → 产出 prd.md

## User Stories

### 账户
1. 作为一个 PM，我想要用邮箱和密码注册账号，以便保护我的项目数据。
2. 作为一个已有账号的 PM，我想要用邮箱和密码登录，以便进入我的项目列表。
3. 作为一个已登录的用户，我想要在任意页面退出登录，以便保护我的账号安全。

### 项目管理
4. 作为一个 PM，我想要创建新项目并命名，以便为不同的产品工作隔离空间。
5. 作为一个 PM，我想要在项目列表中看到我所有项目的名称和创建时间，以便快速找到我要工作的项目。
6. 作为一个 PM，我想要点击项目进入其工作记录列表，以便继续工作。
7. 作为一个 PM，我想要删除不再需要的项目，以便保持列表整洁。

### 工作记录
8. 作为一个 PM，我想要在项目下创建新的工作记录，以便开始一轮新的工作。
9. 作为一个 PM，我想要工作记录的名称由 AI 根据我的第一轮对话自动生成，以便我不必每次手动命名。
10. 作为一个 PM，我想要在工作记录列表中看到该项目下所有的工作记录，以便理解项目的工作历史。
11. 作为一个 PM，我想要点击工作记录进入工作台，以便继续之前的对话。
12. 作为一个 PM，我想要删除不再需要的工作记录，以便保持列表整洁。

### 标签页（Agent 对话）
13. 作为一个 PM，我想要在工作台中新建标签页并选择 Agent 类型（需求分析 或 MVP-PRD），以便开始与该专业 Agent 对话。
14. 作为一个 PM，我想要在标签栏中看到所有打开的标签页，显示"Agent类型 #编号"，以便在不同对话间切换。
15. 作为一个 PM，我想要双击标签页名称进行重命名，以便按我的习惯组织对话。
16. 作为一个 PM，我想要关闭某个标签页（删除该对话），以便清理不再需要的对话。
17. 作为一个 PM，我想要重新打开浏览器后标签页和聊天记录都在，以便跨天工作不丢失进度。

### 需求分析 Agent
18. 作为一个 PM，我想要向需求分析 Agent 描述我的产品想法，Agent 按流程追问用户与场景、痛点、方案，以便我的想法经受系统性的检验。
19. 作为一个 PM，我想要在 Agent 完成诘问后，它自动将结论整理为一条需求的四段分析（用户与场景 / 用户故事 / 功能范围 / 成功指标），以便我确认后写入需求分析.md。
20. 作为一个 PM，我想要对同一个项目从不同角度分析多条需求（开多个需求分析标签页），每条需求独立确认后追加入需求分析.md，以便文件汇总所有分析结论。

### MVP-PRD Agent
21. 作为一个 PM，我想要 PRD Agent 自动加载需求分析.md 中的结论，在对话中进行二次确认而非从零讨论，以便节省时间。
22. 作为一个 PM，我想要 PRD Agent 先产出精简版 PRD（三视角确认 + 概念版 ≤300 字 + 范围冻结），对齐方向后再进入落地版，以便避免方向性返工。
23. 作为一个 PM，我想要 PRD Agent 在落地版中为每个 MVP 功能覆盖用户流程、状态机、字段规范、文案规范、异常处理五个维度，以便落地版 PRD 可以直接用于 vibe coding。
24. 作为一个 PM，我想要在范围冻结后手动确认，Agent 才继续写入落地版，以便我掌控范围。

### 文件系统
25. 作为一个 PM，我想要在文件树中看到项目的所有 md 文件（需求分析.md、prd.md），以便了解当前工作成果。
26. 作为一个 PM，我想要点击文件在预览面板中查看内容，以便快速浏览。
27. 作为一个 PM，我想要点击文件树中的文件将其加载到当前 Agent 的上下文中，以便 Agent 在对话时能参考该文件。
28. 作为一个 PM，我想要看到当前 Agent 已加载了哪些文件（Agent 上下文面板），以便知道我给了 Agent 什么参考材料。
29. 作为一个 PM，我想要从 Agent 上下文中移除某份文件，以便修正错误的上下文。
30. 作为一个 PM，我想要在线编辑 md 文件内容，编辑后 AI 自动润色为规范的 md 格式，以便我对 Agent 产出的内容有最终控制权。
31. 作为一个 PM，我想要每份 md 文件有变更日志头（需求编号、迭代次数、最后编辑时间），以便 Agent 和其他人在阅读时不会混淆版本。
32. 作为一个 PM，我想要下载 md 文件到本地，以便在其他工具中使用。

### 导航与引导
33. 作为一个 PM，我想要在工作台顶部看到一条轻量的流水线指示器，显示我当前处于需求分析还是 PRD 阶段，但不强制锁定，以便我随时知道自己在哪但不被限制。
34. 作为一个 PM，我想要在项目列表为空时看到"创建第一个项目"的引导按钮，以便我知道从何开始。
35. 作为一个 PM，我想要在工作记录列表为空时看到"新建工作记录"的引导，以便我不迷茫。
36. 作为一个 PM，我想要在工作台无标签页时看到创建标签页的引导并列出可选 Agent 类型，以便我知道可以做什么。
37. 作为一个 PM，我想要在文件树为空时看到提示"与 Agent 对话产出第一份文档"，以便我知道文件从何而来。

### 错误与边界
38. 作为一个 PM，我想要在 LLM API 响应超时或失败时看到友好的错误提示，并提供重试按钮，以便我不会因技术故障而丢失工作。
39. 作为一个 PM，我想要 Agent 产出文件之前必须经过我的确认，以便我始终控制文件内容。

## Implementation Decisions

### 技术栈
- **前端 + 后端**：Next.js 14+ App Router，单仓库全栈。API Routes 作为唯一前后端接缝。
- **数据库**：MongoDB（本地实例或 MongoDB Atlas 免费层），使用 Mongoose ODM。
- **鉴权**：NextAuth.js，Credentials Provider（邮箱 + 密码），JWT session。密码使用 bcrypt 哈希存储。
- **AI 对话**：Vercel AI SDK 处理 LLM 流式输出。LLM 实际调用 Anthropic API（Claude），但封装在 API Route 内部，前端不直接调用 LLM。
- **UI 组件**：shadcn/ui（基于 Radix UI + Tailwind CSS）。
- **部署**：本地开发（localhost），不依赖 Vercel。`npm run dev` 启动。

### 数据模型（MongoDB Collections）

- `users` — 用户，字段：email, password_hash, created_at
- `projects` — 项目，字段：name, user_id (ref), created_at
- `work_records` — 工作记录，字段：name (AI 自动生成), project_id (ref), created_at
- `tabs` — 标签页，字段：agent_type, display_name, position, work_record_id (ref)。多个同类型标签页独立上下文。
- `messages` — 聊天消息（嵌入 tabs 或独立集合），字段：role, content, timestamp, tab_id (ref)
- `project_files` — 项目文件，字段：filename, content, changelog (embedded: requirement_count, iteration, last_editor, timestamp), project_id (ref)
- `agent_file_contexts` — Agent 与文件的多对多关系，字段：tab_id (ref), file_id (ref)

### Agent 行为
- 每个 Agent 类型有预置 SystemPrompt，用户创建标签页时自动注入。SystemPrompt 包含角色定义、追问流程、输出格式规范。
- 需求分析 Agent 询问用户 → 总结为四段分析 → 呈现给用户 → 用户确认后写入需求分析.md（追加入已有文件末尾）。
- PRD Agent 创建标签页时自动加载需求分析.md 到上下文 → 三视角二次确认 → 精简版 PRD → 范围冻结确认 → 落地版五个维度详述 → 写入 prd.md。

### API 契约

**Auth**
- `POST /api/auth/register` — 注册
- `POST /api/auth/login` — 登录
- `POST /api/auth/logout` — 登出

**Projects**
- `GET /api/projects` — 列出当前用户的项目
- `POST /api/projects` — 创建项目
- `DELETE /api/projects/:id` — 删除项目

**Work Records**
- `GET /api/projects/:id/work-records` — 列出项目下的工作记录
- `POST /api/projects/:id/work-records` — 创建工作记录
- `DELETE /api/work-records/:id` — 删除工作记录

**Tabs**
- `GET /api/work-records/:id/tabs` — 列出工作记录下的标签页
- `POST /api/work-records/:id/tabs` — 创建标签页（指定 agent_type）
- `PATCH /api/tabs/:id` — 更新标签页（重命名）
- `DELETE /api/tabs/:id` — 删除标签页（及其消息）

**Chat**
- `POST /api/tabs/:id/chat` — 发送消息给 Agent，返回流式响应（SSE）
- `GET /api/tabs/:id/messages` — 获取标签页的历史消息

**Files**
- `GET /api/projects/:id/files` — 列出项目文件
- `GET /api/projects/:id/files/:id` — 获取文件内容
- `PATCH /api/projects/:id/files/:id` — 更新文件（用户手动编辑）
- `POST /api/tabs/:id/files` — 加载文件到 Agent 上下文
- `DELETE /api/tabs/:id/files/:fileId` — 从 Agent 上下文移除文件
- `GET /api/projects/:id/files/:id/download` — 下载文件

### 流式对话
- 前端使用 Vercel AI SDK 的 `useChat` hook 消费 SSE 流。
- 后端 API Route 将用户消息 + Agent SystemPrompt + 已加载文件内容拼接为完整 prompt，调用 Anthropic API，以 stream 模式返回。
- Agent 产出文件内容时，以特殊标记包裹（如 `%%%FILE_BEGIN%%%` ... `%%%FILE_END%%%`），前端解析后弹出确认对话框。

### UI 行为
- 工作台布局：左侧文件树 + Agent 上下文面板，中右聊天区 + 顶部标签栏。
- 标签栏像浏览器标签，overflow 时水平滚动。
- 文件树点击文件 → 右侧弹出预览面板。
- 文件树右键菜单（或操作按钮）：加载到当前 Agent、在线编辑、下载。
- 在线编辑：modal 打开 markdown 编辑器 → 保存 → AI 润色 → 返回确认 → 写入。

## Testing Decisions

- **测试接缝**：API Routes。所有测试通过 HTTP 请求完成。LLM API 调用在该接缝处 mock。
- **集成测试**：每个 API Route 验证请求-响应契约、数据库状态变更、鉴权检查。
- **前端测试**：关键用户流程（注册 → 创建项目 → 创建工作记录 → 与 Agent 对话 → Agent 产出文件）用 mock API 进行端到端验证。
- **不测试**：Agent SystemPrompt 质量（人工评估）、LLM 输出格式一致性（在 Agent 侧处理而非测试侧）。

## Out of Scope

- **原型制作 Agent**：v2 引入，MVP 只有需求分析和 PRD。
- **拖拽文件加载**：v2。MVP 用点击加载/移除。
- **多用户协同**：单用户系统。
- **Agent SystemPrompt 最终版本**：MVP 使用初始版本，后续迭代优化。
- **高级文件编辑**（富文本、diff 对比）：在线编辑仅支持 markdown 文本 + AI 润色。
- **移动端适配**：仅桌面端（PM 工作工具）。
- **国际化**：仅中文。
- **付费/订阅**：MVP 不涉及商业模式。
- **文件版本无限回溯**：服务器资源有限，仅记录最近 3 次变更。
- **Agent 类型定制**：MVP 仅两个 Agent 类型。v2 可扩展。

## Further Notes

- 本 spec 基于 `/grill-with-docs` 的 CONTEXT.md 决策记录，决策详情见 `CONTEXT.md`。
- 本地开发：`npm run dev` 启动 Next.js，需要本地 MongoDB 实例（或 MongoDB Atlas 连接串）。
- Anthropic API Key 通过环境变量 `ANTHROPIC_API_KEY` 注入，不进入代码库。
- LLM 流式响应无托管平台超时限制，但需注意长对话的 token 消耗和用户等待体验。
- 本产品本身就是"专业化 Agent 流水线"理念的验证——如果 MVP 跑通了 2 个 Agent 的流水线，团队可以随时插入更多 Agent 类型。
