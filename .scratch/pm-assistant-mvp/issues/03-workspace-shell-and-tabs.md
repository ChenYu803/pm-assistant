# 03 — 工作台外壳 + 标签页系统

**What to build:** 工作台页面——顶部标签栏（浏览器式），可新建、切换、重命名、关闭标签页。标签页和消息持久化到 MongoDB，刷新后恢复。

**Blocked by:** 02 — 需要项目和工作记录才能进入工作台。

**Status:** ready-for-agent

- [ ] Tab model：agent_type（枚举：requirement_analyst / mvp_prd）, display_name, position, work_record_id (ref)
- [ ] Message model：role（user / assistant / system）, content, timestamp, tab_id (ref)
- [ ] `GET /api/work-records/:id/tabs` — 列出工作记录下所有标签页
- [ ] `POST /api/work-records/:id/tabs` — 创建标签页（参数：agent_type），自动分配 display_name = "需求分析 #N" 或 "MVP-PRD #N"
- [ ] `PATCH /api/tabs/:id` — 更新标签页（重命名 display_name）
- [ ] `DELETE /api/tabs/:id` — 删除标签页（及其所有关联消息 + agent_file_contexts）
- [ ] 工作台页面布局：左侧文件树占位区（留到 Ticket 5），右侧聊天区 + 顶部标签栏
- [ ] 标签栏组件：水平排列，overflow 时水平滚动。每个标签显示 display_name + 关闭按钮
- [ ] 新建标签页：点击"+"按钮 → 弹出对话框，列出可选 Agent 类型（带描述）→ 选择后创建
- [ ] 双击标签 → 名称变可编辑 → 回车确认 → 调 PATCH 接口
- [ ] 关闭标签 → 确认对话框（如果该标签有聊天记录）→ 确认后删除
- [ ] 页面刷新 → 自动恢复标签页列表和最后活跃标签
- [ ] 工作台无标签页空状态："新建一个标签页开始工作"引导 + 可选 Agent 类型列表
