"use client";

import { useState, useEffect } from "react";
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
  onSave: (content: string) => void;
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
  const [content, setContent] = useState(initialContent);
  const [isPolishing, setIsPolishing] = useState(false);
  const [polishedContent, setPolishedContent] = useState<string | null>(null);
  const [polishError, setPolishError] = useState("");

  useEffect(() => {
    if (open) {
      setContent(initialContent);
      setPolishedContent(null);
      setPolishError("");
      setIsPolishing(false);
    }
  }, [open, initialContent]);

  async function handlePolish() {
    if (!polishTarget || !content.trim()) return;
    setIsPolishing(true);
    setPolishError("");
    try {
      const res = await fetch(
        `/api/projects/${polishTarget.projectId}/files/${polishTarget.fileId}/polish`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "AI 润色失败");
      }
      const data = await res.json();
      setPolishedContent(data.polished);
    } catch (err) {
      setPolishError(
        err instanceof Error ? err.message : "AI 润色失败"
      );
    } finally {
      setIsPolishing(false);
    }
  }

  function applyPolish() {
    if (polishedContent) {
      setContent(polishedContent);
      setPolishedContent(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        className="flex w-full max-w-2xl flex-col p-0"
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
            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </Button>
        </div>

        {/* Editor */}
        <div className="flex-1 p-5">
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="h-80 rounded-lg bg-muted p-4 font-mono text-sm"
            placeholder="输入 Markdown 内容..."
            disabled={saving || isPolishing}
          />

          {/* Polish error */}
          {polishError && (
            <p className="mt-2 text-xs text-destructive">{polishError}</p>
          )}

          {/* Polished preview */}
          {polishedContent && (
            <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
              <p className="mb-2 text-xs font-medium text-emerald-700">
                AI 润色结果：
              </p>
              <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap text-xs text-gray-700">
                {polishedContent}
              </pre>
              <div className="mt-2 flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={applyPolish}
                  className="bg-emerald-600 hover:bg-emerald-700"
                >
                  应用润色
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPolishedContent(null)}
                >
                  保留原文
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border px-5 py-3">
          <div className="flex items-center gap-2">
            <p className="text-xs text-muted-foreground">支持 Markdown 格式</p>
            {polishTarget && (
              <Button
                variant="outline"
                size="sm"
                onClick={handlePolish}
                disabled={saving || isPolishing}
                className="border-indigo-200 text-indigo-600 hover:bg-indigo-50 hover:text-indigo-700"
              >
                {isPolishing ? (
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-indigo-300 border-t-indigo-600" />
                    润色中
                  </span>
                ) : (
                  "AI 润色"
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
            <Button onClick={() => onSave(content)} disabled={saving || isPolishing}>
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
