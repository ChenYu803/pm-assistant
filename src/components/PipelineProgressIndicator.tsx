"use client";

import {
  AGENT_TYPE_METADATA,
  PIPELINE_AGENT_TYPES,
  type AgentType,
} from "@/lib/agent-constants";

interface PipelineProgressIndicatorProps {
  agentType: AgentType | null;
  scopeFrozen: boolean;
}

const PHASES = PIPELINE_AGENT_TYPES.map((agentType) => ({
  key: agentType,
  label: AGENT_TYPE_METADATA[agentType].pipelineLabel,
  agentType,
}));

// 由 PHASES 派生（agentType → 阶段序号），避免与 PHASES 双份数据漂移
const PHASE_INDEX_BY_AGENT = Object.fromEntries(
  PHASES.map((phase, index) => [phase.agentType, index])
) as Record<AgentType, number>;

export default function PipelineProgressIndicator({
  agentType,
  scopeFrozen,
}: PipelineProgressIndicatorProps) {
  const currentPhaseIndex = agentType ? PHASE_INDEX_BY_AGENT[agentType] : 0;
  const currentSubLabel =
    agentType === "mvp_prd" ? (scopeFrozen ? "落地版" : "精简版") : null;

  return (
    <div className="flex items-center gap-1.5">
      {PHASES.map((phase, index) => {
        const isActive = index === currentPhaseIndex;
        const isComplete = index < currentPhaseIndex;

        return (
          <div key={phase.key} className="flex items-center gap-1.5">
            {/* Connector line before (skip first) */}
            {index > 0 && (
              <div
                className={`h-[2px] w-4 rounded-full transition-colors ${
                  isActive || isComplete ? "bg-indigo-400" : "bg-gray-200"
                }`}
              />
            )}

            {/* Phase dot + label */}
            <div className="flex items-center gap-1">
              <span
                className={`flex h-2.5 w-2.5 items-center justify-center rounded-full transition-colors ${
                  isComplete
                    ? "bg-emerald-500"
                    : isActive
                      ? "bg-indigo-500 ring-2 ring-indigo-200"
                      : "bg-gray-300"
                }`}
              />
              <span
                className={`text-xs font-medium transition-colors ${
                  isComplete
                    ? "text-emerald-600"
                    : isActive
                      ? "text-indigo-600"
                      : "text-gray-400"
                }`}
              >
                {phase.label}
              </span>
              {isActive && currentSubLabel && (
                <>
                  <span className="text-gray-300 text-xs">·</span>
                  <span className="text-xs text-indigo-500">
                    {currentSubLabel}
                  </span>
                  {scopeFrozen && (
                    <span className="text-xs" title="范围已冻结">
                      🔒
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
