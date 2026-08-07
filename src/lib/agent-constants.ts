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

/** Client-side tab shape (no mongoose dependency) */
export interface TabData {
  id: string;
  agent_type: AgentType;
  display_name: string;
  position: number;
  scope_frozen: boolean;
}
