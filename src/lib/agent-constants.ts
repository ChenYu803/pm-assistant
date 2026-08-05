export const AGENT_TYPES = ["requirement_analyst", "mvp_prd"] as const;
export type AgentType = (typeof AGENT_TYPES)[number];

export const AGENT_TYPE_LABELS: Record<AgentType, string> = {
  requirement_analyst: "需求分析",
  mvp_prd: "MVP-PRD",
};

export const AGENT_TYPE_DESCRIPTIONS: Record<AgentType, string> = {
  requirement_analyst: "分析用户需求，梳理功能点，输出结构化需求文档",
  mvp_prd: "基于需求分析结果，生成 MVP 版本的 PRD 文档",
};

/** Client-side tab shape (no mongoose dependency) */
export interface TabData {
  id: string;
  agent_type: AgentType;
  display_name: string;
  position: number;
}
