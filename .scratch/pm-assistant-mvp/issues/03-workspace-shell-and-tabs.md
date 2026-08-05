# 03 — 工作台外壳 + 标签页系统

**What to build:** 工作台页面——顶部标签栏（浏览器式），可新建、切换、重命名、关闭标签页。标签页和消息持久化到 MongoDB，刷新后恢复。

**Blocked by:** 02 — 需要项目和工作记录才能进入工作台。

**Status:** resolved

- [x] Tab model：agent_type（枚举：requirement_analyst / mvp_prd）, display_name, position, work_record_id (ref)
- [x] Message model：role（user / assistant / system）, content, timestamp, tab_id (ref)
- [x] `GET /api/work-records/:id/tabs` — 列出工作记录下所有标签页
- [x] `POST /api/work-records/:id/tabs` — 创建标签页（参数：agent_type），自动分配 display_name = "需求分析 #N" 或 "MVP-PRD #N"
- [x] `PATCH /api/tabs/:id` — 更新标签页（重命名 display_name）
- [x] `DELETE /api/tabs/:id` — 删除标签页（及其所有关联消息 + agent_file_contexts）
- [x] 工作台页面布局：左侧文件树占位区（留到 Ticket 5），右侧聊天区 + 顶部标签栏
- [x] 标签栏组件：水平排列，overflow 时水平滚动。每个标签显示 display_name + 关闭按钮
- [x] 新建标签页：点击"+"按钮 → 弹出对话框，列出可选 Agent 类型（带描述）→ 选择后创建
- [x] 双击标签 → 名称变可编辑 → 回车确认 → 调 PATCH 接口
- [x] 关闭标签 → 确认对话框（如果该标签有聊天记录）→ 确认后删除
- [x] 页面刷新 → 自动恢复标签页列表和最后活跃标签
- [x] 工作台无标签页空状态："新建一个标签页开始工作"引导 + 可选 Agent 类型列表

## Comments

完成日期：2026-08-05

实现细节：
- Tab 模型位于 `src/models/Tab.ts`，包含 agent_type、display_name、position、work_record_id、created_at
- Message 模型位于 `src/models/Message.ts`，包含 role（user/assistant/system）、content、timestamp、tab_id
- 标签页 CRUD API 全部实现，DELETE 时级联删除关联的 messages 和 agent_file_contexts
- 工作台页面 `src/app/workspace/[workRecordId]/page.tsx` 实现三栏布局：文件树 | 标签栏+聊天区 | 文件预览
- TabBar 组件 `src/components/TabBar.tsx` 支持双击编辑、关闭按钮（hover 时显示）、水平滚动
- AgentTypeDialog `src/components/AgentTypeDialog.tsx` 在新建标签时弹出，列出 Agent 类型及描述
- 活动标签页 ID 通过 localStorage 持久化，刷新后恢复
- 空状态直接在工作台页面中内联渲染（无需额外组件），列出可选 Agent 类型按钮
