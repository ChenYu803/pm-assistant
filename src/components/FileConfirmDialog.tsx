"use client";

import MarkdownRenderer from "@/components/MarkdownRenderer";

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
  if (!open || !file) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="flex w-full max-w-2xl flex-col rounded-xl bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <div className="flex items-center gap-2">
            <span className="text-base">📄</span>
            <h3 className="text-sm font-semibold text-gray-900">
              Agent 产出文件
            </h3>
          </div>
          <button
            onClick={onCancel}
            disabled={saving}
            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors disabled:opacity-50"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Filename + preview */}
        <div className="flex-1 p-5">
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
            <span className="text-sm">📋</span>
            <span className="text-sm font-medium text-amber-800">
              文件：{file.filename}
            </span>
          </div>

          <div className="max-h-80 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-4">
            <MarkdownRenderer content={file.content} />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-gray-200 px-5 py-3">
          <p className="text-xs text-gray-400">
            确认后将保存到项目文件树
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={onCancel}
              disabled={saving}
              className="rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              取消
            </button>
            <button
              onClick={onConfirm}
              disabled={saving}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors disabled:opacity-50"
            >
              {saving ? (
                <span className="flex items-center gap-1">
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  写入中
                </span>
              ) : (
                "确认写入"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
