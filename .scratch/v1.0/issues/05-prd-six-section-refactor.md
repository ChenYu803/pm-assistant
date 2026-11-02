# 05 — PRD Agent 六章重构

**What to build:** PRD Agent 从「五维度」重构为六章骨架（读者是 AI，见 ADR-0002/0003）。新流程：二次确认需求分析结论 → 概念 + 范围（引用需求分析功能范围段，外部依赖声明入概念章单源）→ 直接嵌入原型.md 的页面清单/用户流程（第 3、5 章，零转换）→ 实体聚合 + 业务规则 grilling（业务语言提问）→ 验收标准推导 + 用户确认 → 文案基调 → 六章齐全后输出 prd.md。精简版 PRD 退役为纯对话内流程（三视角确认 → 概念版 ≤300 字 → 范围冻结确认），不写入文档。范围冻结协议（肯定词 + 标记）保持。

**Blocked by:** 04 — 原型 Agent（第 3、5 章嵌入依赖原型.md 产出格式就绪）

**Status:** ready-for-agent

- [x] PRD tab 创建时自动加载 需求分析.md + 原型.md（存在时）
- [x] 先二次确认需求分析结论（不重新讨论）
- [x] 输出六章齐全：① 概念（含外部依赖声明）② Out of Scope（排除项附理由，引用功能范围段）③ 页面清单 ④ 实体级数据模型（字段单源聚合 + 状态机）⑤ 用户流程 + 验收标准（按用户故事组织、异常并入分支、每条 3-5 条「当 X → 系统 Y → 结果 Z」）⑥ 文案基调（三行封顶）
- [x] 第 3、5 章内容与原型.md 一致（嵌入零转换，不重写）
- [x] 精简版在对话内完成且不写入 prd.md；范围冻结协议保持（肯定词 + 标记）
- [x] 外部依赖声明只在概念章出现一次（单源）
- [x] 六章缺一 = 输出未完成，Agent 补全后才写文件（完整性硬规则）
- [x] 验证脚本覆盖：六章齐全断言 + 与原型.md 一致性断言
- [x] 概念版写入文件树独立文件（显式确认弹窗 + 不可加载进 Agent 上下文）【mini 会新增，修订 ADR-0003「不落盘」】

**备注：** 产品决策重镇——开始前需与用户开 PM 决策 mini 会，拍板：业务规则 grilling 的问题设计、外部依赖的识别清单、验收标准的粒度、「概念版 ≤300 字确认完就丢」的对话体验取舍。协议标记三处一致性由 01 号脚本守护。prompt 重写参考公开 skills。

## Comments

### Mini 会决策记录（2026-08-08，已逐条拍板；to-spec skill 照抄级吸收为价值底色）

1. **业务规则 grilling = 补缺式走查**：按实体清单逐个问「需求分析/原型未覆盖」的规则点，每实体 ≤2 问封顶，不重挖需求（to-spec「不访谈纯综合」）。问题用业务语言，示例：「地址记下单时的还是跟买家资料走？」（spec 原文）。
2. **外部依赖识别 = Agent 推断**：Agent 从需求分析内容主动推理候选依赖，列给用户确认，零新增提问轮次；prompt 内置常见依赖类别（支付/登录/消息通知/地图/云存储/AI）作**推理自检线索**防漏检。概念章单源声明不变。
3. **验收标准粒度 = 每条用户故事 3-5 条**（spec US26 原文执行）：每条一句话行为断言「当 X → 系统 Y → 结果 Z」，主路径 1-2 条 + 关键异常 2-3 条；只写外部可观察行为、不写内部实现（to-spec「only test external behavior」）。**消费路径认知**：PRD 第 5 章 = 验收标准单源仓库，任务拆分时按故事垂直切片带走进 issue 的 Acceptance criteria（spec US14）——PRD 写多厚，issue 就有多厚；故事 = 第 5 章组织单元 = 切分原子单元（同一把尺子）。
4. **概念版落盘升级**（修订 ADR-0003「对话内完成、不落盘」）：概念版确认后写入文件树独立文件，写入前复用需求分析.md 的显式确认弹窗；**不可加载进 Agent 上下文**。设计意图：AI 侧单源不破（AI 读不到概念版，prd.md 概念章为正式单源），人侧获得回看锚点。与 spec US28「不写入 prd.md」兼容（独立文件，非 prd.md 章节）。
   - **命名定案：「概念版（Tab N）.md」——不含「工作文档」三字**。依据（已读代码）：ChatArea 弹框逻辑 = 非工作文档 → 弹确认框（`ChatArea.tsx:332`），不含则弹框 ✓ 零代码；写入模式按 agentType（mvp_prd 走整文件替换，`files/route.ts:188`）✓ 零代码；文件树正式样式 ✓。**唯一需补**：context 排除——新增 `isConceptDocFile(filename)`（`file-helpers.ts`），「不可加载」判定从 `isWorkingDocFile` 泛化为 `工作文档 || 概念版`（`context-files.ts:32` 过滤 + FileTree 隐藏「加载到 Agent」+ files route POST 400 三处小改）；弹框判定**保持** `isWorkingDocFile` 不动（概念版必须弹框）。
5. **嵌入裁剪边界定案**（to-spec「Trim to the decision-rich parts」落地）：第 3 章 = 原型.md「页面清单」段正文（`## 页面名` 五字段块）；第 5 章 = 原型.md「用户流程」段正文（`## 用户流程：[场景]` 块：触发/主路径/异常分支/边界情况）；文件头 changelog 注释块用现有 `stripChangelogHeader` 剥离不进 PRD；嵌入 = 原文保留零转换（不重写不润色，结构措辞层级原样）；原型.md 缺「用户流程」段 → 视为第 5 章未完成，PRD Agent 提示用户回原型 tab 补全、不自行重写（原型.md 是第 3/5 章唯一来源，保持单源）。

### to-spec 吸收对照（照抄级，prompt 重写时直接落）

| to-spec 原文 | 吸收形式 | 落点 |
|---|---|---|
| "Do NOT interview the user — just synthesize what you already know" | 二次确认纪律：只复核需求分析结论，不抛新需求挖掘问题 | 第一步 |
| "Use the project's domain glossary vocabulary… respect any ADRs" | 沿用需求分析.md / 原型.md 既有术语，不发明新词 | 全流程 |
| "The fewer seams across the codebase, the better — the ideal number is one" | 验收标准 = 执行者唯一自检接缝，每条可被逐条勾验 | 第 5 章 |
| "A LONG, numbered list of user stories… As an \<actor\>, I want a \<feature\>, so that \<benefit\>" | 第 5 章按用户故事组织，格式「作为一个 \<角色\>，我想要 \<功能\>，以便 \<收益\>」 | 第 5 章 |
| "This list of user stories should be extremely extensive and cover all aspects of the feature" | 用户故事撰写纪律：需求分析.md 的故事只是种子，扩写为详尽列表覆盖所有方面 | 第 5 章 |
| "Do NOT include specific file paths or code snippets. They may end up being outdated very quickly." | 第 4 章字段用业务级类型（引用/枚举/数字），不写 DB 类型/代码片段 | 第 4 章 |
| "if a prototype produced a snippet that encodes a decision more precisely than prose can (state machine…), inline it… Trim to the decision-rich parts" | 第 3、5 章直接嵌入原型.md 零转换；嵌入 = 裁剪到决策富集部分，不含 HTML 媒介细节 | 第 3、5 章 |
| "only test external behavior, not implementation details" | 验收标准只写外部可观察行为 | 第 5 章 |
| "Apply the ready-for-agent triage label — no need for additional triage" | 六章齐全 + 范围冻结后一次性写入 prd.md，不二次评审 | 写入环节 |

## 跨 ticket 债务（来自 03-requirement-analyst-discipline）

03 mini 会决策 #5：PRD 第 2 章（Out of Scope）应**整体引用**需求分析.md 的「# 排除清单」段（每条 = 被排除需求 + 排除理由 + 取舍阶段），而非仅引用功能范围段内的行内排除表述。实现本 ticket 第 2 章时对齐该决策。
