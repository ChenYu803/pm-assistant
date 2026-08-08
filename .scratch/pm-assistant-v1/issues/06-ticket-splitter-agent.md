# 06 — 任务拆分 Agent（新 Agent 全栈）

**What to build:** 任务拆分阶段闭环：用户在 PRD 完成后打开「任务拆分」tab（自动加载 prd.md + 需求分析.md），Agent 先 quiz 用户（issue 粒度偏好 / 依赖处理 / 是否合并拆分），再将 PRD 切成垂直切片 issues 文件集——每个 issue = 窄但完整（该页面的 schema/API/UI/流程，一个全新上下文窗口可完成），含 what to build（用户视角端到端行为）+ acceptance criteria（从 PRD 验收标准带走）+ blocked by；issue 引用 PRD 章节而非复制；按依赖序编号输出到 issues/ 下；文件树以子目录展示 issues 文件、可下载；用户逐个确认/拒绝写入。

**Blocked by:** 02 — Agent 类型基础设施；05 — PRD Agent 六章重构（切分对象是六章 PRD 的章节引用）

**Status:** ready-for-agent

- [x] 任务拆分 tab 创建时自动加载 prd.md + 需求分析.md（存在时）
- [x] 切分前先 quiz 用户（粒度/依赖/合并偏好）
- [x] 输出 issues 文件集：NN-<slug>.md 按依赖序编号
- [x] 每 issue 含 what to build（用户视角端到端行为）+ acceptance criteria + blocked by
- [x] issue 正文引用 PRD 章节（如「见 prd.md 第 3 章 页面 2」），不复制内容
- [x] 写入 API 支持 issues/ 子路径文件名；文件树子目录展示；可下载
- [x] 用户逐个确认/拒绝 issue 写入（拒绝的不落盘）
- [x] 验证脚本覆盖：切片格式 / blocked by / 引用非复制 / 编号序断言

## Comments

### 实施完成记录（2026-08-08，已全量验证通过）

- **切分流程照抄 to-tickets**：草案（标题/Blocked by/交付行为三要素编号列表）→ quiz 三问（粒度/blocking edges/合并拆分）→ 迭代至批准 → 按依赖序一次输出 issues 文件集 → 回复末尾简述 frontier。
- **无 %%%SCOPE_FROZEN%%%**：切分批准 = 「必须确认」prompt 纪律（对标 requirement_analyst 模式），不落盘由前端弹框兜底；US19 要求批准输出后仍可重新切分，冻结与之冲突——已记入协议快照。
- **验收标准直接带走**（第 5 章 AC 行复制是 prompt 明文要求的合规行为，非「引用非复制」违规；引用非复制约束的是 schema/状态机等决策编码）。
- **实现**：prompt 重写（`agent-prompts.ts` 末尾）；ChatArea 确认弹窗队列化（逐个确认/拒绝）；FileTree 子目录分组展示；下载取 basename；写入 API 零改动（唯一索引天然支持 `issues/` 子路径）。
- **验证**：`scripts/verify-ticket-splitter.mjs` 绿 22/22（真实对话 3 轮，断言：四字段 / blocked by / 编号序 / 引用非复制含 AC 例外 / 逐个确认拒绝不落盘 / 重切分无冻结）；回归 verify-protocols 27/27、verify-agent-types 18/18、verify-prototype-agent 20/20、verify-prd-six-section 27/27（其脚本已适配确认队列：循环点掉全部弹窗）。

**备注：** 部分产品决策——开始前需与用户确认：quiz 的问题设计、垂直切片的粒度直觉（页面级 vs 功能级）、what to build 的叙事口径。切分规则学习公开 /to-tickets 技能（垂直切片、blocking edges）。

## Comments

### Mini 会决策记录（2026-08-08，已逐条拍板；to-tickets skill 照抄级吸收为价值底色）

1. **quiz 顺序 = 先出草案再 quiz（照抄 to-tickets 第 4 步）**：Agent 读完 prd.md + 需求分析.md 后**先出切片草案**（编号列表：标题 / Blocked by / 交付行为），再按标准三问确认：① 粒度对吗（太粗/太细）② blocking edges 对吗（只依赖真门控）③ 要合并/拆分吗。迭代至用户批准。**修订 spec「切分前 quiz」表述**——quiz 是草案确认而非预问偏好，草案比空问具体、用户回答成本低（to-tickets 被验证过的顺序）。
2. **切片粒度 = 用户故事级 + 垂直完整（tracer bullet）**：一个 issue = 一个用户故事的垂直切片（该故事的 schema/API/UI/流程 全在切片内，跨多页的故事切片含多页）。判据 = **「独立可演示/可验证」**（不能单独 demo = 太窄或漏层）；尺寸 = 单个全新上下文窗口可完成。与 05 决策「第 5 章用户故事 = 切分原子单元」无缝衔接——AC 按故事直接从第 5 章带走。
3. **what to build 口径 = 照抄 to-tickets**：用户视角端到端行为，**禁止逐层实现清单**；不写文件路径/代码片段（过时快）；schema/状态机等决策编码**引用 PRD 章节**（第 4 章实体数据模型等）而非复制（与 US15 引用非复制一致）；例外——原型产出的决策编码可内联并注明来源（trim to the decision-rich parts）。垂直完整是切片的属性，不是叙事字段的内容。
4. **横切改动 = 纳入 expand-contract 规则（to-tickets 宽重构例外）**：跨页面共享数据模型改动不硬塞垂直切片；切为「数据模型 expand」（先行，新旧并存）→ 各页面迁移 issue（blocked by expand，每批独立可验证）→ 「删除旧字段」contract issue（blocked by 全部迁移批）。
5. **blocking edges 语义 = 照抄 to-tickets**：每个 issue 只依赖**真正门控**它的；编号 = 拓扑序（blockers first，从 01 起），多条并行链交叉编号；用户实现时按 **frontier** 推进（blockers 全完成的先做），非强制线性。
6. **UI 展示名 = 「任务拆分」转正**：02 已在创建弹窗/空态/管线指示器使用，spec 待定项结清，不再改。
7. **产物 issue 字段 = 四字段**：what to build + acceptance criteria + blocked by + **Status: ready-for-agent**（照抄 to-tickets 模板；06 spec 原三字段补 Status，用户外部 vibe coding 可标记进度，亦合本项目 triage 惯例）。
