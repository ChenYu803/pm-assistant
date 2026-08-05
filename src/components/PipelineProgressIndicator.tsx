"use client";

import type { AgentType } from "@/lib/agent-constants";

interface PipelineProgressIndicatorProps {
  agentType: AgentType | null;
  scopeFrozen: boolean;
}

const PHASES = [
  { key: "requirements", label: "需求分析", agentType: "requirement_analyst" as const },
  { key: "prd", label: "PRD 撰写", agentType: "mvp_prd" as const },
] as const;

export default function PipelineProgressIndicator({
  agentType,
  scopeFrozen,
}: PipelineProgressIndicatorProps) {
  const currentPhaseIndex = agentType === "mvp_prd" ? 1 : 0;
  const currentSubLabel =
    agentType === "mvp_prd"
      ? scopeFrozen
        ? "落地版"
        : "精简版"
      : null;

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
