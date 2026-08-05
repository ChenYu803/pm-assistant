"use client";

import type { ProjectFileData } from "@/lib/file-helpers";

interface FileTreeProps {
  files: ProjectFileData[];
  loading: boolean;
  error: string;
  selectedFileId: string | null;
  onSelect: (file: ProjectFileData) => void;
  activeTabId: string | null;
  onLoadToAgent: (file: ProjectFileData) => void;
  onEdit: (file: ProjectFileData) => void;
  onDownload: (file: ProjectFileData) => void;
}

export default function FileTree({
  files,
  loading,
  error,
  selectedFileId,
  onSelect,
  activeTabId,
  onLoadToAgent,
  onEdit,
  onDownload,
}: FileTreeProps) {
  return (
    <aside className="flex h-full w-56 shrink-0 flex-col border-r border-gray-200 bg-white">
      {/* Header */}
      <div className="shrink-0 border-b border-gray-100 px-3 py-2.5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
          项目文件
        </h3>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
          </div>
        )}

        {error && !loading && (
          <div className="px-3 py-4 text-center">
            <p className="text-xs text-red-500">{error}</p>
          </div>
        )}

        {!loading && !error && files.length === 0 && (
          <EmptyState />
        )}

        {!loading && files.length > 0 && (
          <ul className="py-1">
            {files.map((file) => {
              const isSelected = file.id === selectedFileId;
              const timeAgo = formatTimeAgo(file.updated_at);
              return (
                <li key={file.id} className="group relative">
                  <button
                    onClick={() => onSelect(file)}
                    className={`w-full px-3 py-2 text-left transition-colors ${
                      isSelected
                        ? "bg-indigo-50 text-indigo-700"
                        : "text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm">📄</span>
                      <span className="truncate text-sm font-medium">
                        {file.filename}
                      </span>
                    </div>
                    <p className="mt-0.5 pl-6 text-xs text-gray-400">
                      {timeAgo}
                    </p>
                  </button>

                  {/* Hover action buttons */}
                  <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 rounded bg-white/80 px-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    {/* Load to agent */}
                    {activeTabId && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onLoadToAgent(file);
                        }}
                        className="rounded p-1 text-gray-500 hover:bg-indigo-100 hover:text-indigo-600 transition-colors"
                        title="加载到 Agent"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m0 0l-6-6m6 6l6-6" />
                        </svg>
                      </button>
                    )}
                    {/* Edit */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onEdit(file);
                      }}
                      className="rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600 transition-colors"
                      title="编辑"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    {/* Download */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDownload(file);
                      }}
                      className="rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600 transition-colors"
                      title="下载"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center px-3 py-8 text-center">
      <div className="mb-3 text-3xl">📁</div>
      <p className="text-xs font-medium text-gray-500">暂无文件</p>
      <p className="mt-1 text-xs leading-relaxed text-gray-400">
        与 Agent 对话产出第一份文档
      </p>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTimeAgo(date: Date): string {
  const now = Date.now();
  const diff = now - new Date(date).getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  if (hours < 24) return `${hours} 小时前`;
  if (days < 7) return `${days} 天前`;
  return new Date(date).toLocaleDateString("zh-CN");
}
