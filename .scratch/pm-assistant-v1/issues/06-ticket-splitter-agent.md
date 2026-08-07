# 06 — 任务拆分 Agent（新 Agent 全栈）

**What to build:** 任务拆分阶段闭环：用户在 PRD 完成后打开「任务拆分」tab（自动加载 prd.md + 需求分析.md），Agent 先 quiz 用户（issue 粒度偏好 / 依赖处理 / 是否合并拆分），再将 PRD 切成垂直切片 issues 文件集——每个 issue = 窄但完整（该页面的 schema/API/UI/流程，一个全新上下文窗口可完成），含 what to build（用户视角端到端行为）+ acceptance criteria（从 PRD 验收标准带走）+ blocked by；issue 引用 PRD 章节而非复制；按依赖序编号输出到 issues/ 下；文件树以子目录展示 issues 文件、可下载；用户逐个确认/拒绝写入。

**Blocked by:** 02 — Agent 类型基础设施；05 — PRD Agent 六章重构（切分对象是六章 PRD 的章节引用）

**Status:** ready-for-agent

- [ ] 任务拆分 tab 创建时自动加载 prd.md + 需求分析.md（存在时）
- [ ] 切分前先 quiz 用户（粒度/依赖/合并偏好）
- [ ] 输出 issues 文件集：NN-<slug>.md 按依赖序编号
- [ ] 每 issue 含 what to build（用户视角端到端行为）+ acceptance criteria + blocked by
- [ ] issue 正文引用 PRD 章节（如「见 prd.md 第 3 章 页面 2」），不复制内容
- [ ] 写入 API 支持 issues/ 子路径文件名；文件树子目录展示；可下载
- [ ] 用户逐个确认/拒绝 issue 写入（拒绝的不落盘）
- [ ] 验证脚本覆盖：切片格式 / blocked by / 引用非复制 / 编号序断言

**备注：** 部分产品决策——开始前需与用户确认：quiz 的问题设计、垂直切片的粒度直觉（页面级 vs 功能级）、what to build 的叙事口径。切分规则学习公开 /to-tickets 技能（垂直切片、blocking edges）。
