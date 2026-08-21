"use client";

import {
  AGENT_TYPES,
  AGENT_TYPE_METADATA,
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
      <DialogContent className="max-w-lg">
        <DialogTitle>选择 Agent 类型</DialogTitle>
        <DialogDescription>
          先了解每个 Agent 需要什么、会产出什么，再选择要开始的环节
        </DialogDescription>

        <ul className="mt-4 max-h-[min(65vh,32rem)] space-y-3 overflow-y-auto pr-1">
          {AGENT_TYPES.map((type) => (
            <li key={type}>
              <button
                onClick={() => onSelect(type)}
                className="w-full rounded-lg border border-border p-4 text-left transition-colors hover:border-gray-400 hover:bg-accent"
              >
                <div className="flex items-start gap-3">
                  <span className="text-2xl" aria-hidden="true">
                    {AGENT_TYPE_METADATA[type].icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-foreground">
                      {AGENT_TYPE_METADATA[type].label}
                    </div>
                    <dl className="mt-3 grid gap-2 text-sm">
                      <div>
                        <dt className="font-medium text-foreground">职责</dt>
                        <dd className="mt-0.5 text-muted-foreground">
                          {AGENT_TYPE_METADATA[type].responsibility}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-medium text-foreground">需要你提供什么</dt>
                        <dd className="mt-0.5 text-muted-foreground">
                          {AGENT_TYPE_METADATA[type].input}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-medium text-foreground">会产出什么</dt>
                        <dd className="mt-0.5 text-muted-foreground">
                          {AGENT_TYPE_METADATA[type].output}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-medium text-foreground">在流水线中的位置</dt>
                        <dd className="mt-0.5 text-muted-foreground">
                          {AGENT_TYPE_METADATA[type].pipelinePosition}
                        </dd>
                      </div>
                    </dl>
                  </div>
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
