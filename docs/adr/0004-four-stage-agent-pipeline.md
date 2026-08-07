# ADR-0004 — Agent 流水线扩展为四环：原型 Agent + 任务拆分 Agent

v1.0 原范围划线里「新增 Agent（具体待 grill）」待定。按逆推链（PRD 结构 → 所需信息 → 所需 Agent）推演后确认两个缺口：① 页面清单、用户流程（PRD 第 3、5 章）在行业惯例里本属**原型阶段**产物——PRD Agent 无法可靠推导，且缺「可视化确认」（用户对文本确认的把握度低于看图）；② PRD 是可切分的，但没有 Agent 负责把 PRD 切成 issues——用户外部 vibe coding 的消费方式是「每 issue 一个对话」（单对话装 PRD + issues + 当前 issue 实现，远离模型「变蠢区间」≈140k~150k tokens）。

**决策：产品 Agent 流水线扩展为四环（需求分析 → 原型产出 → PRD 撰写 → 任务拆分），新增两个 Agent：**

1. **原型 Agent**（进 v1.0）：
   - 定位：**确认工具**（非展示品）。最终交付物 = **结构化文本**（页面清单 + 用户流程，格式即 PRD 第 3、5 章格式，PRD Agent 直接嵌入零转换）；**HTML 只是给用户看的可视化媒介，不参与交付**
   - 流程：需求分析敲定后 → **提案式访谈**（设计师式：先给方案再问，与需求分析 Agent 的诘问式相反）→ 主动声明「可生成简单 HTML 原型，下载后浏览器打开」→ 用户看可视化确认/修正 → 改结构化文本 → **每轮修订重新生成 HTML 快照**（保可视化确认闭环）→ 用户显式确认「完满」（原型冻结协议，肯定词校验）→ 进入 PRD 阶段
   - 关键洞察：HTML=媒介 → 模型代差（视觉上限）与验证闭环两个质量差距被结构性消解，DeepSeek + 特化 prompt 足够
   - 新交接物：原型.md；实体字段起点从原型「页面元素」浮现，PRD Agent 聚合而非从头 grilling
2. **任务拆分 Agent**（进 v1.0）：学习 `/to-tickets`——**垂直切片**（一个 issue = 窄但完整：该页面的 schema/API/UI/流程，大小 = 一个全新上下文窗口能完成）、blocking edges（依赖）声明、切分前 quiz 用户（粒度/依赖/合并拆分）；切分单元 = PRD 第 3 章页面清单（骨架）+ 第 5 章依赖声明（blocking）+ 验收标准（issue 字段，直接带走）；issue 格式 = what to build（用户视角端到端行为）+ acceptance criteria + blocked by；**引用 PRD 章节而非复制**（单源）；输出 issues 文件集（`issues/NN-<slug>.md`，按依赖序编号）

**配套决策：**

- **选择标准修订**：新增 Agent 以「提升『PRD → vibe coding 跑通』完整链路（PRD 质量本身 + 落地性）」为第一标准；新手引导性/环节丰富度为第二标准，不因「看起来丰富」而加——PRD 质量高低由链路质量决定、由 vibe coding 成功与否评判
- **v1.0 完成标志更新**：作者本人（唯一用户）从零走完「想法 → 需求分析.md → 原型.md → prd.md → issues 文件集」，拿到的 PRD + issues 实际 vibe coding 一次跑通
- **v1.0 范围划线更新**：进 = PRD 结构重构（六章，见 ADR-0003）+ 方案 B 输出保障 + 原型 Agent + 任务拆分 Agent + 需求分析 Agent 微调（功能范围段充实：做 X + 不做 Y 及理由）；出（维持）= 模板案例、新手引导、成果导出

**被否备选**：text-first 替代（页面/流程由 PRD Agent 文本推导 + 文本导航树确认——缺可视化确认，且 PRD Agent 职责膨胀）；原型 Agent v2 再引入（可视化确认价值对新手最大，v1.0 即需）；任务拆分 defer（完成标志「vibe coding 跑通」需要 issues 交付物，且「每 issue 一对话」的消费方式依赖它）；拆「数据建模 Agent」（PRD 内部环节再切只增加交接物，违背「环节粒度 = 阶段」的产品理念）。

**后果**：v1.0 工作量增加（两个新 Agent + 需求分析微调 + PRD Agent 重构）；file tree 增加原型.md 与 issues/（下载走 MVP 已有文件机制）；原型 Agent 与 PRD 范围冻结共两次显式确认（实现要轻，防流程过重）；产品流水线 = matt 主流程的产品化（需求分析≈grill / 原型≈prototype / PRD≈to-spec / 任务拆分≈to-tickets / 用户外部 vibe coding≈implement）——亦是三步走第 2 步教学素材。
