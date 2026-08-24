"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import type { PendingFile } from "@/components/FileConfirmDialog";

interface TicketSetConfirmDialogProps {
  open: boolean;
  files: PendingFile[];
  saving: boolean;
  onReplace: () => void;
  onSaveAs: () => void;
  onCancel: () => void;
}

export default function TicketSetConfirmDialog({
  open,
  files,
  saving,
  onReplace,
  onSaveAs,
  onCancel,
}: TicketSetConfirmDialogProps) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !saving) onCancel(); }}>
      <DialogContent
        className="flex w-full max-w-3xl flex-col p-0"
        onPointerDownOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => { if (saving) event.preventDefault(); }}
      >
        <div className="border-b border-border px-5 py-4">
          <DialogTitle className="text-sm font-semibold">新的 tickets 版本</DialogTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            本次结果共 {files.length} 张 ticket。选择整套替换当前版本，或另存为新版本。
          </p>
        </div>
        <div className="max-h-[30rem] space-y-2 overflow-y-auto p-5">
          {files.map((file) => {
            const isExpanded = expanded === file.id;
            return (
              <div key={file.id} className="rounded-md border border-border">
                <button
                  type="button"
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm"
                  onClick={() => setExpanded(isExpanded ? null : file.id)}
                  disabled={saving}
                >
                  <span className="font-medium">{file.filename}</span>
                  <span className="text-xs text-muted-foreground">{isExpanded ? "收起" : "预览"}</span>
                </button>
                {isExpanded && (
                  <div className="border-t border-border bg-muted/40 p-3 text-sm">
                    <MarkdownRenderer content={file.content} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-border px-5 py-3">
          <Button variant="outline" onClick={onCancel} disabled={saving}>取消</Button>
          <Button variant="outline" onClick={onSaveAs} disabled={saving}>
            {saving ? "保存中..." : "另存为新版本"}
          </Button>
          <Button onClick={onReplace} disabled={saving}>
            {saving ? "替换中..." : "替换当前版本"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
