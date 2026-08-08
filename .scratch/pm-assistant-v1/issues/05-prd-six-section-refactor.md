# 05 — PRD Agent 六章重构

**What to build:** PRD Agent 从「五维度」重构为六章骨架（读者是 AI，见 ADR-0002/0003）。新流程：二次确认需求分析结论 → 概念 + 范围（引用需求分析功能范围段，外部依赖声明入概念章单源）→ 直接嵌入原型.md 的页面清单/用户流程（第 3、5 章，零转换）→ 实体聚合 + 业务规则 grilling（业务语言提问）→ 验收标准推导 + 用户确认 → 文案基调 → 六章齐全后输出 prd.md。精简版 PRD 退役为纯对话内流程（三视角确认 → 概念版 ≤300 字 → 范围冻结确认），不写入文档。范围冻结协议（肯定词 + 标记）保持。

**Blocked by:** 04 — 原型 Agent（第 3、5 章嵌入依赖原型.md 产出格式就绪）

**Status:** ready-for-agent

- [ ] PRD tab 创建时自动加载 需求分析.md + 原型.md（存在时）
- [ ] 先二次确认需求分析结论（不重新讨论）
- [ ] 输出六章齐全：① 概念（含外部依赖声明）② Out of Scope（排除项附理由，引用功能范围段）③ 页面清单 ④ 实体级数据模型（字段单源聚合 + 状态机）⑤ 用户流程 + 验收标准（按用户故事组织、异常并入分支、每条 3-5 条「当 X → 系统 Y → 结果 Z」）⑥ 文案基调（三行封顶）
- [ ] 第 3、5 章内容与原型.md 一致（嵌入零转换，不重写）
- [ ] 精简版在对话内完成且不写入 prd.md；范围冻结协议保持（肯定词 + 标记）
- [ ] 外部依赖声明只在概念章出现一次（单源）
- [ ] 六章缺一 = 输出未完成，Agent 补全后才写文件（完整性硬规则）
- [ ] 验证脚本覆盖：六章齐全断言 + 与原型.md 一致性断言

**备注：** 产品决策重镇——开始前需与用户开 PM 决策 mini 会，拍板：业务规则 grilling 的问题设计、外部依赖的识别清单、验收标准的粒度、「概念版 ≤300 字确认完就丢」的对话体验取舍。协议标记三处一致性由 01 号脚本守护。prompt 重写参考公开 skills。

## 跨 ticket 债务（来自 03-requirement-analyst-discipline）

03 mini 会决策 #5：PRD 第 2 章（Out of Scope）应**整体引用**需求分析.md 的「# 排除清单」段（每条 = 被排除需求 + 排除理由 + 取舍阶段），而非仅引用功能范围段内的行内排除表述。实现本 ticket 第 2 章时对齐该决策。

## Comments

### Mini 会决策记录（2026-08-08，已逐条拍板；参照 to-spec skill 照抄级吸收——九条对照表见对齐汇报，实施时逐条写进 prompt）

1. **业务规则 grilling = 补缺式走查**：按实体清单逐个问「需求分析/原型未覆盖」的规则点，每实体 ≤2 问封顶；只补缺口、不重挖需求（to-spec「不访谈，纯综合」的落地）。
2. **外部依赖识别 = Agent 推断**（用户纠正，非机械「从文档提取」）：Agent 基于需求分析内容**主动推理**候选依赖，列给用户确认；prompt 内置常见依赖类别（支付/登录/消息通知/地图/云存储/AI）作**推理自检线索**——防漏检、不新增提问轮次。
3. **验收标准粒度 = 一句话断言 + 条数下限**：每条验收标准为一句可勾验的行为断言（当 X → 系统 Y → 结果 Z，不展开边界细节；「像 spec 用户故事一样简洁」= **文字简洁度**，非条数）；每条用户故事 **3-5 条起步、宁多勿少**（用户拍板：3-5 条不厚、嫌少——修正 US26「3-5 条」上限语义为下限）；防注水靠「每条一句话可勾验」约束，不靠条数上限。参照：to-spec 无验收标准章（验收隐含在 User Stories extensive + Testing Decisions「只测外部行为」）；to-tickets 的 acceptance criteria 仅 checkbox 一条一行、无句式无条数规定——「当 X → Y → Z + 条数」是本项目对 to-spec 原则的工程化增强。
4. **概念版落盘升级（对 spec US28 的修正）**：概念版不「对话内确认完就丢」——写入文件树（独立文件，命名沿用工作文档惯例「概念版（Tab N）.md」），但**不可加载进 Agent 上下文**（复用工作文档机制：context panel 排除 + 文件树标记），写入前**显式确认弹窗**（复用需求分析.md 的确认弹窗路径）。设计自洽：AI 侧永远只读 prd.md 单源（ADR-0003 单源不破），文件树概念版 = 给人回看的确认存档。

**范围说明：** 决策 #4 超出原 ticket 范围（原为「对话内完成、不写入 prd.md」）——新增概念版文件落盘机制（写入识别 / context 排除 / 确认弹窗，与 03 工作文档机制同路径）。实现时对齐 03 的 file-helpers 识别逻辑，评估是否泛化复用。

### to-spec 照抄级吸收清单（2026-08-08 对齐会产出；用户拍板：优秀处照抄，非借鉴）

to-spec = mattpocock/skills 的「对话→spec」skill（本地完整版：`~/.claude/skills/to-spec/SKILL.md`，75 行，模板七段内嵌；无验收标准章）。重写 MVP_PRD_PROMPT 时逐条照抄：

1. "Do NOT interview the user — just synthesize what you already know" → 二次确认纪律：只复核需求分析结论，**不抛出新的需求挖掘问题**
2. "Use the project's domain glossary vocabulary… respect any ADRs" → 全程沿用需求分析.md / 原型.md 已建立术语，不发明新词
3. "The fewer seams across the codebase, the better — the ideal number is one" → 验收标准 = 执行者唯一自检接缝：每条必须可逐条勾验
4. "A LONG, numbered list of user stories. As an <actor>, I want a <feature>, so that <benefit>" → 第 5 章按用户故事组织，格式「作为一个 <角色>，我想要 <功能>，以便 <收益>」
5. **"This list of user stories should be extremely extensive and cover all aspects of the feature"** → 用户故事撰写纪律（关键句，用户点名）：需求分析.md 的用户故事是种子，PRD Agent 扩写为详尽列表覆盖所有方面
6. "Do NOT include specific file paths or code snippets. They may end up being outdated very quickly." → 第 4 章字段用业务级类型（引用/枚举/数字），不写 DB 类型/代码片段
7. "if a prototype produced a snippet that encodes a decision more precisely than prose can (state machine…), inline it… Trim to the decision-rich parts" → 第 3、5 章直接嵌入原型.md（零转换）；嵌入 = 裁剪到决策富集部分，不含 HTML 媒介细节
8. "only test external behavior, not implementation details" → 验收标准只写外部可观察行为，不写内部实现
9. "Apply the ready-for-agent triage label — no need for additional triage" → 六章齐全 + 范围冻结后一次性写入 prd.md，不二次评审
