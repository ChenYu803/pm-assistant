"use client";

import { useState, useEffect } from "react";

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

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="flex w-full max-w-2xl flex-col rounded-xl bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <div className="flex items-center gap-2">
            <span className="text-base">📝</span>
            <h3 className="text-sm font-semibold text-gray-900">
              编辑 {filename}
            </h3>
          </div>
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors disabled:opacity-50"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Editor */}
        <div className="flex-1 p-5">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="h-80 w-full resize-none rounded-lg border border-gray-200 bg-gray-50 p-4 font-mono text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400"
            placeholder="输入 Markdown 内容..."
            disabled={saving || isPolishing}
          />

          {/* Polish error */}
          {polishError && (
            <p className="mt-2 text-xs text-red-500">{polishError}</p>
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
                <button
                  onClick={applyPolish}
                  className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 transition-colors"
                >
                  应用润色
                </button>
                <button
                  onClick={() => setPolishedContent(null)}
                  className="rounded-md border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  保留原文
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-gray-200 px-5 py-3">
          <div className="flex items-center gap-2">
            <p className="text-xs text-gray-400">支持 Markdown 格式</p>
            {polishTarget && (
              <button
                onClick={handlePolish}
                disabled={saving || isPolishing}
                className="rounded-md border border-indigo-200 bg-white px-3 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50 transition-colors disabled:opacity-50"
              >
                {isPolishing ? (
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-indigo-300 border-t-indigo-600" />
                    润色中
                  </span>
                ) : (
                  "AI 润色"
                )}
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={saving || isPolishing}
              className="rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              取消
            </button>
            <button
              onClick={() => onSave(content)}
              disabled={saving || isPolishing}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors disabled:opacity-50"
            >
              {saving ? (
                <span className="flex items-center gap-1">
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  保存中
                </span>
              ) : (
                "保存"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
