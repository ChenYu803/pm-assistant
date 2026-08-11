export const AGENT_TYPES = [
  "requirement_analyst",
  "mvp_prd",
  "prototype",
  "ticket_splitter",
] as const;
export type AgentType = (typeof AGENT_TYPES)[number];

export const AGENT_TYPE_LABELS: Record<AgentType, string> = {
  requirement_analyst: "需求分析",
  mvp_prd: "MVP-PRD",
  prototype: "原型",
  ticket_splitter: "任务拆分",
};

export const AGENT_TYPE_DESCRIPTIONS: Record<AgentType, string> = {
  requirement_analyst: "分析用户需求，梳理功能点，输出结构化需求文档",
  mvp_prd: "基于需求分析结果，生成 MVP 版本的 PRD 文档",
  prototype: "基于需求分析，产出页面清单与用户流程的原型方案",
  ticket_splitter: "将 PRD 拆分为按依赖排序、可直接实施的开发任务",
};

/** 各 Agent 类型图标（流水线全景 / 空标签页提示共用，避免多处硬编码漂移）。 */
export const AGENT_TYPE_ICONS: Record<AgentType, string> = {
  requirement_analyst: "📋",
  mvp_prd: "📝",
  prototype: "🎨",
  ticket_splitter: "✂️",
};

/**
 * 四环流水线顺序（空状态全景渲染顺序）：需求分析 → 原型 → PRD → 任务拆分。
 * 注意与 AGENT_TYPES（Agent 选择弹窗展示顺序）不同——流水线顺序是业务
 * 推进顺序，Agent 顺序是并列可选列表。
 */
export const PIPELINE_AGENT_TYPES: AgentType[] = [
  "requirement_analyst",
  "prototype",
  "mvp_prd",
  "ticket_splitter",
];

/** Client-side tab shape (no mongoose dependency) */
export interface TabData {
  id: string;
  agent_type: AgentType;
  display_name: string;
  position: number;
  scope_frozen: boolean;
}
