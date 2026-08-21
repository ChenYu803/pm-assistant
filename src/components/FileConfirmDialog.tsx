"use client";

import MarkdownRenderer from "@/components/MarkdownRenderer";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useState } from "react";

export interface FileToConfirm {
  filename: string;
  content: string;
}

export interface PendingFile extends FileToConfirm {
  id: string;
  messageId: string | null;
}

interface FileConfirmDialogProps {
  open: boolean;
  files: PendingFile[];
  saving: boolean;
  onConfirm: (files: PendingFile[]) => void;
  onCancel: () => void;
}

export default function FileConfirmDialog({
  open,
  files,
  saving,
  onConfirm,
  onCancel,
}: FileConfirmDialogProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(files.map((file) => file.id))
  );

  const toggleFile = (id: string) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedFiles = files.filter((file) => selectedIds.has(file.id));

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent
        className="flex w-full max-w-2xl flex-col p-0"
        // 与现有行为一致：点击遮罩不关闭；保存中 Escape 也不关闭
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => {
          if (saving) e.preventDefault();
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="flex items-center gap-2">
            <span className="text-base">📄</span>
            <DialogTitle className="text-sm font-semibold">
              Agent 产出文件
            </DialogTitle>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onCancel}
            disabled={saving}
            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </Button>
        </div>

        {/* File list + previews */}
        <div className="max-h-[28rem] flex-1 space-y-3 overflow-y-auto p-5">
          {files.map((file) => (
            <label
              key={file.id}
              className="block cursor-pointer rounded-lg border border-border p-3 hover:bg-muted/50"
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={selectedIds.has(file.id)}
                  onChange={() => toggleFile(file.id)}
                  disabled={saving}
                  className="mt-1 h-4 w-4 accent-primary"
                  aria-label={`选择 ${file.filename}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                    <span className="text-sm">📋</span>
                    <span className="truncate text-sm font-medium text-amber-800">
                      文件：{file.filename}
                    </span>
                  </div>
                  <div className="max-h-48 overflow-y-auto rounded-lg border border-border bg-muted p-4">
                    <MarkdownRenderer content={file.content} />
                  </div>
                </div>
              </div>
            </label>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border px-5 py-3">
          <p className="text-xs text-muted-foreground">
            已选择 {selectedFiles.length} / {files.length} 个文件
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onCancel} disabled={saving}>
              全部丢弃
            </Button>
            <Button
              onClick={() => onConfirm(selectedFiles)}
              disabled={saving || selectedFiles.length === 0}
            >
              {saving ? (
                <span className="flex items-center gap-1">
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  写入中
                </span>
              ) : (
                `批量写入${selectedFiles.length > 0 ? ` (${selectedFiles.length})` : ""}`
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
