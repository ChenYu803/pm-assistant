"use client";

import { useFilePolish } from "@/components/useFilePolish";
import { FilePolishResult } from "@/components/FilePolishResult";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface FileEditorModalProps {
  open: boolean;
  filename: string;
  initialContent: string;
  saving: boolean;
  onSave: (content: string) => Promise<boolean>;
  onClose: () => void;
  /** 传入 projectId + fileId 后会显示「AI 润色」按钮 */
  polishTarget?: { projectId: string; fileId: string };
}

export default function FileEditorModal({
  open,
  filename,
  initialContent,
  saving,
  onSave,
  onClose,
  polishTarget,
}: FileEditorModalProps) {
  const polish = useFilePolish(open,polishTarget,initialContent);
  const {content,busy:isPolishing} = polish;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        className="flex max-h-[90dvh] w-full max-w-2xl flex-col p-0"
        // 与现有行为一致：点击遮罩不关闭；保存/润色中 Escape 也不关闭
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => {
          if (saving || isPolishing) e.preventDefault();
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="flex items-center gap-2">
            <span className="text-base">📝</span>
            <DialogTitle className="text-sm font-semibold">
              编辑 {filename}
            </DialogTitle>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            disabled={saving}
            aria-label="关闭编辑器"
            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </Button>
        </div>

        {/* Editor */}
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <Textarea
            value={content}
            onChange={(e) => polish.edit(e.target.value)}
            className="h-80 rounded-lg bg-muted p-4 font-mono text-sm"
            placeholder="输入 Markdown 内容..."
            disabled={saving || isPolishing || polish.pending}
          />

          {polishTarget && <FilePolishResult polish={polish} />}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border px-5 py-3">
          <div className="flex items-center gap-2">
            <p className="text-xs text-muted-foreground">支持 Markdown 格式</p>
            {polishTarget && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void polish.polish()}
                disabled={saving || isPolishing || !polish.ready || !content.trim()}
                className="border-indigo-200 text-indigo-600 hover:bg-indigo-50 hover:text-indigo-700"
              >
                {isPolishing ? (
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-indigo-300 border-t-indigo-600" />
                    润色中
                  </span>
                ) : (
                  (polish.pending ? "重试原请求" : "AI 润色")
                )}
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={onClose}
              disabled={saving || isPolishing}
            >
              取消
            </Button>
            <Button onClick={async () => { if (await onSave(content)) polish.saved(); }} disabled={saving || isPolishing}>
              {saving ? (
                <span className="flex items-center gap-1">
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  保存中
                </span>
              ) : (
                "保存"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
