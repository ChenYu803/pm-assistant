"use client";

import { useState } from "react";

export interface ContextFile {
  id: string;
  filename: string;
}

interface AgentContextPanelProps {
  contextFiles: ContextFile[];
  loading: boolean;
  onRemove: (fileId: string) => void;
}

export default function AgentContextPanel({
  contextFiles,
  loading,
  onRemove,
}: AgentContextPanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  if (collapsed) {
    return (
      <div className="flex h-full shrink-0 flex-col border-r border-gray-200 bg-white">
        <button
          onClick={() => setCollapsed(false)}
          className="flex h-full w-10 items-start justify-center pt-3 text-gray-400 hover:bg-gray-50 hover:text-gray-600 transition-colors"
          title="展开 Agent 上下文"
        >
          <span className="text-sm">📎</span>
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full w-48 shrink-0 flex-col border-r border-gray-200 bg-white">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          <span className="text-xs">📎</span>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
            当前 Agent 已加载的文件
          </h3>
        </div>
        <button
          onClick={() => setCollapsed(true)}
          className="rounded p-0.5 text-gray-300 hover:bg-gray-100 hover:text-gray-500 transition-colors"
          title="收起"
        >
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
          </div>
        )}

        {!loading && contextFiles.length === 0 && (
          <div className="flex flex-col items-center px-2 py-6 text-center">
            <div className="mb-2 text-xl">📎</div>
            <p className="text-xs leading-relaxed text-gray-400">
              点击文件树中的文件加载到 Agent 上下文
            </p>
          </div>
        )}

        {!loading && contextFiles.length > 0 && (
          <ul className="py-1">
            {contextFiles.map((file) => (
              <li
                key={file.id}
                className="group flex items-center justify-between px-3 py-1.5 hover:bg-gray-50"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-xs shrink-0">📄</span>
                  <span className="truncate text-xs text-gray-700">
                    {file.filename}
                  </span>
                </div>
                <button
                  onClick={() => onRemove(file.id)}
                  className="ml-1 shrink-0 rounded p-0.5 text-gray-400 opacity-0 hover:bg-gray-200 hover:text-gray-600 group-hover:opacity-100 transition-opacity"
                  title="移除"
                >
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

