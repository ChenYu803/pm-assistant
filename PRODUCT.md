# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

主要用户是正在求职、缺少实际 PM 工作经验的学生，当前产品作者本人就是典型用户。

用户需要把一个模糊的产品想法逐步整理成可以用于求职展示和后续 vibe coding 的产品交付物。

## Product Purpose

PM Assistant 是一个面向求职 PM 的产品工作流网站。它把从想法到可执行交付物的过程拆成多个职责明确的 Agent 阶段，帮助用户完成：

需求分析 → 原型 → PRD → issues → 后续 vibe coding

产品成功的标准是：缺少 PM 工作经验的用户也能独立走完整条流水线，并拿到可以直接用于 vibe coding 的 PRD 和 issues。

## Positioning

产品的核心机制不是让一个通用聊天窗口包办所有工作，而是让多个专业 Agent 各自负责一个阶段，并通过结构化 Markdown 交接物连接起来。

## Operating Context

用户在浏览器中创建项目和工作记录，进入不同 Agent 标签页进行独立对话。各 Agent 共享项目级文件，但保留各自的对话上下文。用户可以查看、确认、拒绝和编辑 Agent 产出的 Markdown 文件，并将最终 PRD 和 issues 带到外部 vibe coding 工作流中。

## Capabilities and Constraints

- 当前产品包含需求分析、原型、MVP PRD 和任务拆分四类 Agent。
- 主要交付物是需求分析.md、原型.md、prd.md 和 issues 文件集。
- 用户对文件写入拥有最终确认权。
- 需求分析、原型、PRD 和任务拆分之间通过文件和明确的协议标记交接。
- 产品主语言为中文。
- 技术栈是 Next.js、MongoDB/Mongoose、NextAuth.js、OpenAI SDK 和 Tailwind CSS。
- AI 服务使用 OpenAI 兼容的 Chat Completions 调用格式，供应商、地址和模型由环境变量配置。
- 本地自动化验证默认使用固定回放，不调用真实模型；真实模型只用于有限的 prompt 行为验证。
- 产品需要保持低成本验证，不能把多轮真实模型对话作为日常回归前提。
- 用户可以自由跳过、返回或切换流水线阶段，不被流程强制锁死；空工作记录首次进入时只引导从需求分析开始。

## Brand Commitments

- 产品名称：PM Assistant。
- 面向求职 PM，表达应直白、可理解，不能假设用户已经掌握完整 PM 术语。
- 用户始终拥有内容和文件的最终决定权。

## Evidence on Hand

- 产品领域上下文：CONTEXT.md
- 产品进度与交接：PROGRESS.md
- v1.0 与 v1.1 规格：.scratch/pm-assistant-v1.1/spec.md
- v1.1 tickets：.scratch/pm-assistant-v1.1/issues/
- 架构决策：docs/adr/
- 当前网站实现：src/

## Product Principles

1. AI 负责提高执行效率，用户负责判断和决策。
2. Agent 是流程中的专业协作者，不是替用户做最终决定的黑箱。
3. 每个阶段都应产出可检查、可交接、可继续使用的成果。
4. 产品体验优先保证流程可走通，再逐步提升单个 Agent 的输出质量。
5. 验证成本必须与实际风险匹配，自动化回归优先使用确定性的低成本方式。
