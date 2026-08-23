export const AGENT_TYPES = [
  "requirement_analyst",
  "mvp_prd",
  "prototype",
  "ticket_splitter",
] as const;
export type AgentType = (typeof AGENT_TYPES)[number];

export interface AgentTypeMetadata {
  label: string;
  icon: string;
  responsibility: string;
  input: string;
  output: string;
  pipelinePosition: string;
  pipelineLabel: string;
  pipelineStep: number;
  emptyStatePrompt: string;
}

/**
 * Agent 的产品说明唯一数据源。
 * 选择弹窗、流水线空状态和标签页空状态都从这里读取，避免文案漂移。
 */
export const AGENT_TYPE_METADATA: Record<AgentType, AgentTypeMetadata> = {
  requirement_analyst: {
    label: "需求分析",
    icon: "📋",
    responsibility: "我来帮你把模糊想法变成一条条清晰的需求",
    input: "一个产品想法、要解决的问题，以及你已知的目标用户和约束",
    output: "需求分析.md：每条需求包含用户与场景、用户故事、功能范围和成功指标",
    pipelinePosition: "第 1 步：需求分析",
    pipelineLabel: "需求分析",
    pipelineStep: 1,
    emptyStatePrompt: "描述你想做的产品或想解决的问题，我来帮你一步步梳理",
  },
  prototype: {
    label: "原型",
    icon: "🎨",
    responsibility: "我来帮你把需求变成页面和用户流程",
    input: "需求分析.md，或你对页面和用户操作流程的初步想法",
    output: "原型.md：页面清单、用户流程和 HTML 原型快照",
    pipelinePosition: "第 2 步：原型",
    pipelineLabel: "原型",
    pipelineStep: 2,
    emptyStatePrompt:
      "告诉我产品要解决什么问题，以及用户要完成什么任务，我来帮你画出页面和流程",
  },
  mvp_prd: {
    label: "MVP-PRD",
    icon: "📝",
    responsibility: "我来帮你把需求和原型整理成可执行的 PRD",
    input: "需求分析.md、原型.md，以及你确认的产品范围",
    output: "prd.md：六章结构的 MVP PRD，可直接交给 AI 执行",
    pipelinePosition: "第 3 步：PRD 撰写",
    pipelineLabel: "PRD 撰写",
    pipelineStep: 3,
    emptyStatePrompt:
      "把需求分析和原型交给我，并确认产品范围，我来帮你整理成能执行的 PRD",
  },
  ticket_splitter: {
    label: "任务拆分",
    icon: "✂️",
    responsibility: "我来帮你把 PRD 拆成能逐个实现的开发任务",
    input: "prd.md，以及需要遵守的技术和交付约束",
    output: "issues/NN-<slug>.md：按依赖排序的开发任务，每张票都带验收标准",
    pipelinePosition: "第 4 步：任务拆分",
    pipelineLabel: "任务拆分",
    pipelineStep: 4,
    emptyStatePrompt:
      "把 PRD 和技术约束交给我，我来帮你拆成按依赖排序的开发任务",
  },
};

const mapMetadata = <T,>(selector: (metadata: AgentTypeMetadata) => T) =>
  Object.fromEntries(
    AGENT_TYPES.map((type) => [type, selector(AGENT_TYPE_METADATA[type])])
  ) as Record<AgentType, T>;

export const AGENT_TYPE_LABELS = mapMetadata((metadata) => metadata.label);
export const AGENT_TYPE_DESCRIPTIONS = mapMetadata(
  (metadata) => metadata.responsibility
);

/** 各 Agent 类型图标（流水线全景 / 空标签页提示共用，避免多处硬编码漂移）。 */
export const AGENT_TYPE_ICONS = mapMetadata((metadata) => metadata.icon);

/**
 * 四环流水线顺序（空状态全景渲染顺序）：需求分析 → 原型 → PRD → 任务拆分。
 * 注意与 AGENT_TYPES（Agent 选择弹窗展示顺序）不同——流水线顺序是业务
 * 推进顺序，Agent 顺序是并列可选列表。
 */
export const PIPELINE_AGENT_TYPES: AgentType[] = [...AGENT_TYPES].sort(
  (a, b) =>
    AGENT_TYPE_METADATA[a].pipelineStep - AGENT_TYPE_METADATA[b].pipelineStep
);

/** Client-side tab shape (no mongoose dependency) */
export interface TabData {
  id: string;
  agent_type: AgentType;
  display_name: string;
  position: number;
  scope_frozen: boolean;
  version: number;
}
