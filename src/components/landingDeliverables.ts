/** 首屏转台与「产品实践」区共用的四份交付物：一份成果的四个阶段。 */
export const deliverables = [
  { title: "需求分析", file: "需求分析.md", verb: "把问题看清楚", lines: ["用户与真实场景", "问题与证据", "范围与优先级"] },
  { title: "原型", file: "原型.md", verb: "让想法看得见", lines: ["页面与信息结构", "关键交互", "状态与边界"] },
  { title: "PRD", file: "prd.md", verb: "让共识可执行", lines: ["目标与产品范围", "功能与行为", "验收标准"] },
  { title: "任务拆分", file: "issues/", verb: "让交付有下一步", lines: ["实现任务", "依赖与顺序", "完成与验收"] },
] as const;

export type Deliverable = (typeof deliverables)[number];
