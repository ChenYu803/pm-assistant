"use client";

import { AGENT_TYPES, AGENT_TYPE_LABELS, AGENT_TYPE_DESCRIPTIONS, type AgentType } from "@/lib/agent-constants";

interface AgentTypeDialogProps {
  open: boolean;
  onClose: () => void;
  onSelect: (agentType: AgentType) => void;
}

export default function AgentTypeDialog({
  open,
  onClose,
  onSelect,
}: AgentTypeDialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h2 className="mb-1 text-lg font-semibold text-gray-900">
          选择 Agent 类型
        </h2>
        <p className="mb-4 text-sm text-gray-500">
          选择要启动的 AI Agent，它将帮助您完成相应的工作
        </p>

        <ul className="space-y-2">
          {AGENT_TYPES.map((type) => (
            <li key={type}>
              <button
                onClick={() => onSelect(type)}
                className="w-full rounded-lg border border-gray-200 p-4 text-left hover:border-gray-400 hover:bg-gray-50 transition-colors"
              >
                <div className="font-medium text-gray-900">
                  {AGENT_TYPE_LABELS[type]}
                </div>
                <div className="mt-0.5 text-sm text-gray-500">
                  {AGENT_TYPE_DESCRIPTIONS[type]}
                </div>
              </button>
            </li>
          ))}
        </ul>

        <div className="mt-4 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-md bg-gray-100 px-4 py-2 text-sm text-gray-700 hover:bg-gray-200 transition-colors"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
