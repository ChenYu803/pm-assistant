"use client";

import { useState } from "react";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import FileEditorModal from "@/components/FileEditorModal";
import type { ProjectFileData } from "@/lib/file-helpers";
import { Button } from "@/components/ui/button";

interface FilePreviewPanelProps {
  file: ProjectFileData | null;
  open: boolean;
  saving: boolean;
  onClose: () => void;
  onSaveEdit: (fileId: string, content: string) => Promise<void>;
  projectId: string;
}

export default function FilePreviewPanel({
  file,
  open,
  saving,
  onClose,
  onSaveEdit,
  projectId,
}: FilePreviewPanelProps) {
  const [showEditor, setShowEditor] = useState(false);

  if (!open || !file) return null;

  function handleDownload() {
    // Trigger download via the API endpoint
    const a = document.createElement("a");
    a.href = `/api/projects/${projectId}/files/${file!.id}/download`;
    a.download = file!.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  async function handleSave(content: string) {
    await onSaveEdit(file!.id, content);
    setShowEditor(false);
  }

  return (
    <>
      {/* Panel overlay on the right side of workspace */}
      <div className="flex h-full w-96 shrink-0 flex-col border-l border-gray-200 bg-white">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-base">📄</span>
            <h3 className="text-sm font-semibold text-gray-900">
              {file.filename}
            </h3>
          </div>
          <div className="flex items-center gap-1">
            {/* Edit button */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowEditor(true)}
              disabled={saving}
              className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              title="编辑"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </Button>

            {/* Download button */}
            <Button
              variant="ghost"
              size="icon"
              onClick={handleDownload}
              className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              title="下载"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </Button>

            {/* Close button */}
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              title="关闭"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </Button>
          </div>
        </div>

        {/* Content preview */}
        <div className="flex-1 overflow-y-auto p-4">
          <MarkdownRenderer content={file.content} />
        </div>

        {/* Saving indicator */}
        {saving && (
          <div className="border-t border-gray-100 px-4 py-2">
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
              保存中...
            </div>
          </div>
        )}
      </div>

      {/* Editor modal */}
      <FileEditorModal
        open={showEditor}
        filename={file.filename}
        initialContent={file.content}
        saving={saving}
        onSave={handleSave}
        onClose={() => setShowEditor(false)}
        polishTarget={{ projectId, fileId: file.id }}
      />
    </>
  );
}
