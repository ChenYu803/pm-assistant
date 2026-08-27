# AI 产品经理职业认知文件：一手来源调研

> 用途：为 v1.4 #06 正文提供事实底座，不替代产品观点。检索日期：2026-08-27。

## 1. 生成式 AI 的能力、局限与可靠性

- 生成式 AI 擅长生成、改写、归纳和辅助判断，但输出具有非确定性：相同输入可能得到不同结果，传统软件测试不足以覆盖这种变化。OpenAI 因此把 eval 定义为结构化测试，并建议围绕真实任务建立目标、数据集、指标、对比实验和持续评测，而不是凭“感觉可用”。来源：[OpenAI Evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices)
- NIST 将“confabulation”定义为模型自信地给出错误或虚假内容，并同时列出数据隐私、有害偏见、信息完整性、信息安全、知识产权和第三方组件等风险。可靠性不是“模型够聪明”这一项，而是要结合具体场景、影响严重度和发生概率管理。来源：[NIST AI 600-1 GenAI Profile](https://doi.org/10.6028/NIST.AI.600-1)
- NIST 建议用 `GOVERN / MAP / MEASURE / MANAGE` 贯穿设计、开发、部署、运行和退役，按组织风险容忍度设定上线门槛，保留评测记录并持续复查。来源：[NIST AI RMF](https://www.nist.gov/itl/ai-risk-management-framework)、[GenAI Profile](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence)
- 同一模型在不同用户、流程和后果等级下，风险并不相同。NIST 区分模型、系统、具体用例和生态层风险；所以“模型排行榜更高”不能替代业务场景验证，PM 仍需写清谁会用、错误会伤害谁、何时降级或停用。来源：[NIST AI 600-1 GenAI Profile](https://doi.org/10.6028/NIST.AI.600-1)

## 2. Human-in-the-loop 与责任边界

- 人机协作不是“AI 做、人签字”，而是按任务风险分配控制权。Google PAIR 建议根据任务、用户专业度和操控成本设计合适的自主程度；用户应能决定委托什么、如何执行、何时收回控制，并通过反馈回路持续校准系统。来源：[Google People + AI Guidebook](https://pair.withgoogle.com/guidebook/)
- Microsoft 的 18 条 Human-AI Interaction 指南要求产品说明系统能做什么、做得多好；当 AI 错误时，用户应能高效忽略、纠正或恢复；还要提供解释、细粒度反馈和全局控制。来源：[Microsoft HAX Design Library](https://www.microsoft.com/en-us/haxtoolkit/library/)
- OpenAI 建议在可能时由人审查输出，尤其是高风险领域和代码生成；复核者必须知道系统局限，并能看到验证所需的原始材料。由此可推：AI 可承担草拟、归纳和候选方案，人对目标、取舍、事实核验、上线与后果负责。来源：[OpenAI Safety best practices](https://developers.openai.com/api/docs/guides/safety-best-practices)

## 3. 发现价值、评测与交付物

- “哪里值得用 AI”应从用户问题和成功标准开始，而不是从模型能力倒推功能。Google PAIR 将第一章定义为理解用户真实问题，以决定“是否以及如何使用 AI”；并提醒效率收益不保证更便宜、更好用，必须融入真实工作流验证。来源：[Google People + AI Guidebook](https://pair.withgoogle.com/guidebook/)
- Google 还提醒，用户在真实情境中的行为可能不同于基准、训练或调优数据；用户旅程、数据收集和模型评测应尽早对齐真实使用情境。这支持先做小范围场景试验，再决定是否扩大投入。来源：[Google People + AI Guidebook](https://pair.withgoogle.com/guidebook/)
- 可借鉴的 AI PM 工作闭环是：问题与用户旅程 → AI/非 AI 方案取舍 → 能力边界与失败模式 → 场景化数据集和指标 → 原型/PRD → 灰度、反馈、监控与复盘。OpenAI 明确要求 task-specific eval、典型/边界/对抗样本以及人工判断校准；NIST 要求明确角色、阈值、事件响应和文档留存。来源：[OpenAI 评测指南](https://developers.openai.com/api/docs/guides/evaluation-best-practices)、[NIST GenAI Profile](https://doi.org/10.6028/NIST.AI.600-1)
- 因而可沉淀的交付物包括：机会说明、用户流程、能力/风险边界、数据与 eval 集、指标门槛、PRD/原型、人工兜底方案、上线与监控计划、复盘记录。这是对上述框架的产品化归纳，不是任何机构规定的岗位模板。

## 4. Vibe Coding 的合理边界

- GitHub 将自然语言编码工具的适用场景列为新项目原型、增量功能、测试和文档；同时明确其可能漏掉问题、产生假阳性、不准确或不安全代码，要求人在合并前审查并测试。来源：[GitHub Copilot Agents Application Card](https://docs.github.com/en/copilot/responsible-use/agents)
- 因此，Vibe Coding 适合快速验证低风险想法和缩短“需求到可体验 demo”的距离；涉及账号、支付、隐私、权限、关键业务数据或生产发布时，不能把“页面能跑”当成完成，仍需测试、安全检查、权限隔离和专业研发评审。后一条风险分层是面向本产品用户的保守建议，不是 GitHub 对“Vibe Coding”的正式定义。

## 不能由来源直接证明的产品观点

- “AI 产品经理分为合格/优秀”“最终成为产研闭环超级个体”属于本产品的成长叙事，官方框架不提供这类岗位分级。
- “PM 最怕麻烦、研发不怕麻烦”是便于记忆的角色比喻，不是可验证的职业事实，正文宜标为观点而非定义。
- “AI 产品经理必须能 Vibe Coding”没有统一行业标准支撑；更稳妥的表述是：它是扩大验证和交付半径的进阶能力，不替代工程质量责任。
