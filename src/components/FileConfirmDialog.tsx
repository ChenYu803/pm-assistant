"use client";

import MarkdownRenderer from "@/components/MarkdownRenderer";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export interface FileToConfirm {
  filename: string;
  content: string;
}

interface FileConfirmDialogProps {
  open: boolean;
  file: FileToConfirm | null;
  saving: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function FileConfirmDialog({
  open,
  file,
  saving,
  onConfirm,
  onCancel,
}: FileConfirmDialogProps) {
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

        {/* Filename + preview */}
        <div className="flex-1 p-5">
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
            <span className="text-sm">📋</span>
            <span className="text-sm font-medium text-amber-800">
              文件：{file?.filename}
            </span>
          </div>

          <div className="max-h-80 overflow-y-auto rounded-lg border border-border bg-muted p-4">
            {file && <MarkdownRenderer content={file.content} />}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border px-5 py-3">
          <p className="text-xs text-muted-foreground">
            确认后将保存到项目文件树
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onCancel} disabled={saving}>
              取消
            </Button>
            <Button onClick={onConfirm} disabled={saving}>
              {saving ? (
                <span className="flex items-center gap-1">
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  写入中
                </span>
              ) : (
                "确认写入"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
