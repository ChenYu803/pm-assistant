# 02 — 项目 + 工作记录 CRUD

**What to build:** 用户可在项目列表页创建/删除项目。进入项目后在工作记录列表页创建/删除工作记录。工作记录名称在首轮对话后由 AI 生成。空状态有两层引导。

**Blocked by:** 01 — 用户必须能登录才能操作项目。

**Status:** resolved

- [x] Project model：name, user_id (ref), created_at
- [x] WorkRecord model：name, project_id (ref), created_at
- [x] `GET /api/projects` — 当前用户的项目列表
- [x] `POST /api/projects` — 创建项目
- [x] `DELETE /api/projects/:id` — 删除项目（验证归属）
- [x] `GET /api/projects/:id` — 获取单个项目信息（附加，用于面包屑导航）
- [x] `GET /api/projects/:id/work-records` — 项目下的工作记录列表
- [x] `POST /api/projects/:id/work-records` — 创建工作记录
- [x] `DELETE /api/work-records/:id` — 删除工作记录（验证归属）
- [x] `PATCH /api/work-records/:id` — 更新工作记录（预留重命名接口）
- [x] 项目列表页 UI：卡片或表格、新建项目按钮、"创建第一个项目"空状态 CTA
- [x] 工作记录列表页 UI：列表 + 新建按钮 + 返回项目列表面包屑、"新建工作记录"空状态 CTA
- [x] 工作记录名称初始可为空或"未命名"，首次对话后由 AI 填充（AI 命名逻辑在 Ticket 4 实现；此处预留字段和更新接口即可）
