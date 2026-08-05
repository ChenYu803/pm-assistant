"use client";

import {
  AGENT_TYPES,
  AGENT_TYPE_LABELS,
  AGENT_TYPE_DESCRIPTIONS,
  type AgentType,
} from "@/lib/agent-constants";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

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
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogTitle>选择 Agent 类型</DialogTitle>
        <DialogDescription>
          选择要启动的 AI Agent，它将帮助您完成相应的工作
        </DialogDescription>

        <ul className="mt-4 space-y-2">
          {AGENT_TYPES.map((type) => (
            <li key={type}>
              <button
                onClick={() => onSelect(type)}
                className="w-full rounded-lg border border-border p-4 text-left transition-colors hover:border-gray-400 hover:bg-accent"
              >
                <div className="font-medium text-foreground">
                  {AGENT_TYPE_LABELS[type]}
                </div>
                <div className="mt-0.5 text-sm text-muted-foreground">
                  {AGENT_TYPE_DESCRIPTIONS[type]}
                </div>
              </button>
            </li>
          ))}
        </ul>

        <div className="mt-4 flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
