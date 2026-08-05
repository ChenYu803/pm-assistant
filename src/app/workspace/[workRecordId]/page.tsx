"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import TabBar from "@/components/TabBar";
import ChatArea from "@/components/ChatArea";
import AgentTypeDialog from "@/components/AgentTypeDialog";
import FileTree from "@/components/FileTree";
import FilePreviewPanel from "@/components/FilePreviewPanel";
import PipelineProgressIndicator from "@/components/PipelineProgressIndicator";
import AgentContextPanel, { type ContextFile } from "@/components/AgentContextPanel";
import { AGENT_TYPES, AGENT_TYPE_LABELS, AGENT_TYPE_DESCRIPTIONS, type AgentType } from "@/lib/agent-constants";
import type { TabData } from "@/lib/agent-constants";
import type { ProjectFileData } from "@/lib/file-helpers";

interface WorkRecord {
  id: string;
  name: string;
  project_id: string;
}

interface Project {
  id: string;
  name: string;
}

function getActiveTabKey(workRecordId: string): string {
  return `pm-assistant-active-tab:${workRecordId}`;
}

export default function WorkspacePage() {
  const params = useParams();
  const workRecordId = params.workRecordId as string;
  const storageKey = getActiveTabKey(workRecordId);

  const [tabs, setTabs] = useState<TabData[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAgentDialog, setShowAgentDialog] = useState(false);
  const [creating, setCreating] = useState(false);
  const [workRecord, setWorkRecord] = useState<WorkRecord | null>(null);
  const [project, setProject] = useState<Project | null>(null);

  // File tree state
  const [files, setFiles] = useState<ProjectFileData[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState("");

  // File preview state
  const [selectedFile, setSelectedFile] = useState<ProjectFileData | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [savingFile, setSavingFile] = useState(false);

  // Agent context state
  const [contextFiles, setContextFiles] = useState<ContextFile[]>([]);
  const [contextLoading, setContextLoading] = useState(false);

  // Fetch tabs
  const fetchTabs = useCallback(async () => {
    try {
      setError("");
      const res = await fetch(`/api/work-records/${workRecordId}/tabs`);
      if (!res.ok) {
        if (res.status === 404) throw new Error("工作记录不存在或无权访问");
        throw new Error("获取标签页失败");
      }
      const data = await res.json();
      setTabs(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "获取标签页失败");
    } finally {
      setLoading(false);
    }
  }, [workRecordId]);

  // Fetch context files for active tab
  const fetchContextFiles = useCallback(async () => {
    if (!activeTabId) {
      setContextFiles([]);
      return;
    }
    setContextLoading(true);
    try {
      const res = await fetch(`/api/tabs/${activeTabId}/files`);
      if (res.ok) {
        const data = await res.json();
        setContextFiles(data.files || []);
      }
    } catch {
      // Silently fail — non-critical
    } finally {
      setContextLoading(false);
    }
  }, [activeTabId]);

  useEffect(() => {
    fetchContextFiles();
  }, [fetchContextFiles]);

  async function handleLoadFileToContext(file: ProjectFileData) {
    if (!activeTabId) return;
    try {
      const res = await fetch(`/api/tabs/${activeTabId}/files`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_id: file.id }),
      });
      if (res.ok) {
        await fetchContextFiles();
      } else if (res.status === 409) {
        // Already in context — no error needed
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "加载文件失败");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载文件失败");
    }
  }

  async function handleRemoveFileFromContext(fileId: string) {
    if (!activeTabId) return;
    try {
      const res = await fetch(`/api/tabs/${activeTabId}/files/${fileId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        await fetchContextFiles();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "移除文件失败");
    }
  }

  async function handleEditFile(file: ProjectFileData) {
    if (!project) return;
    try {
      const res = await fetch(
        `/api/projects/${project.id}/files/${file.id}`
      );
      if (res.ok) {
        setSelectedFile(await res.json());
      } else {
        setSelectedFile(file);
      }
    } catch {
      setSelectedFile(file);
    }
    setPreviewOpen(true);
  }

  function handleDownloadFile(file: ProjectFileData) {
    if (!project) return;
    const a = document.createElement("a");
    a.href = `/api/projects/${project.id}/files/${file.id}/download`;
    a.download = file.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // Fetch work record info (for breadcrumb and project ID)
  useEffect(() => {
    let cancelled = false;
    async function fetchWorkRecord() {
      try {
        const res = await fetch(`/api/work-records/${workRecordId}`);
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setWorkRecord(data);
        }
      } catch {
        // Silently fail — non-critical
      }
    }
    fetchWorkRecord();
    return () => {
      cancelled = true;
    };
  }, [workRecordId]);

  // Fetch project info once we have the work record
  useEffect(() => {
    if (!workRecord) return;
    let cancelled = false;
    async function fetchProject() {
      try {
        const res = await fetch(`/api/projects/${workRecord!.project_id}`);
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setProject(data);
        }
      } catch {
        // Silently fail
      }
    }
    fetchProject();
    return () => {
      cancelled = true;
    };
  }, [workRecord]);

  // Fetch files when project is loaded
  const fetchFiles = useCallback(async () => {
    if (!project) return;
    setFilesLoading(true);
    setFilesError("");
    try {
      const res = await fetch(`/api/projects/${project.id}/files`);
      if (!res.ok) throw new Error("获取文件列表失败");
      const data = await res.json();
      setFiles(data);
      // Clear preview if selected file is no longer in the list
      setSelectedFile((prev) => {
        if (prev && !data.some((f: ProjectFileData) => f.id === prev.id)) {
          return null;
        }
        return prev;
      });
    } catch (err) {
      setFilesError(err instanceof Error ? err.message : "获取文件列表失败");
    } finally {
      setFilesLoading(false);
    }
  }, [project]);

  useEffect(() => {
    if (project) {
      fetchFiles();
    }
  }, [project, fetchFiles]);

  useEffect(() => {
    fetchTabs();
  }, [fetchTabs]);

  // Restore active tab from localStorage when tabs change
  useEffect(() => {
    if (tabs.length === 0) {
      setActiveTabId(null);
      return;
    }

    const stored = localStorage.getItem(storageKey);
    if (stored && tabs.some((t) => t.id === stored)) {
      setActiveTabId(stored);
    } else {
      // Default to first tab
      setActiveTabId(tabs[0].id);
    }
  }, [tabs, storageKey]);

  // Persist active tab changes
  useEffect(() => {
    if (activeTabId) {
      localStorage.setItem(storageKey, activeTabId);
    } else {
      localStorage.removeItem(storageKey);
    }
  }, [activeTabId, storageKey]);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

  async function handleCreateTab(agentType: AgentType) {
    setShowAgentDialog(false);
    setCreating(true);
    try {
      const res = await fetch(`/api/work-records/${workRecordId}/tabs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_type: agentType }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "创建标签页失败");
      }
      const responseData = await res.json();
      // Handle new response shape: { tab, context_files } or legacy flat tab
      const newTab: TabData = responseData.tab ?? responseData;
      const autoLoadedFiles: ContextFile[] = responseData.context_files ?? [];
      // Persist immediately so the restore effect won't override
      localStorage.setItem(storageKey, newTab.id);
      setTabs((prev) => [...prev, newTab]);
      setActiveTabId(newTab.id);
      // Update context files if any were auto-loaded
      if (autoLoadedFiles.length > 0) {
        setContextFiles(autoLoadedFiles);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建标签页失败");
    } finally {
      setCreating(false);
    }
  }

  async function handleRenameTab(tabId: string, newName: string) {
    // Optimistic update
    setTabs((prev) =>
      prev.map((t) => (t.id === tabId ? { ...t, display_name: newName } : t))
    );

    try {
      const res = await fetch(`/api/tabs/${tabId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: newName }),
      });
      if (!res.ok) {
        throw new Error("重命名失败");
      }
    } catch {
      // Revert on failure
      await fetchTabs();
    }
  }

  async function handleCloseTab(tabId: string) {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;

    const confirmed = confirm(
      `确定要关闭标签页「${tab.display_name}」吗？该标签页的聊天记录将被删除。`
    );
    if (!confirmed) return;

    // Optimistic removal
    const wasActive = tabId === activeTabId;
    setTabs((prev) => prev.filter((t) => t.id !== tabId));

    try {
      const res = await fetch(`/api/tabs/${tabId}`, { method: "DELETE" });
      if (!res.ok) {
        throw new Error("删除失败");
      }
    } catch {
      await fetchTabs();
      return;
    }

    // Switch to another tab if we closed the active one
    if (wasActive) {
      setTabs((prev) => {
        if (prev.length > 0) {
          const nextId = prev[0].id;
          localStorage.setItem(storageKey, nextId);
          setActiveTabId(nextId);
        }
        return prev;
      });
    }
  }

  async function handleSelectFile(file: ProjectFileData) {
    if (!project) return;
    // File list omits content — fetch full file from detail endpoint
    try {
      const res = await fetch(
        `/api/projects/${project.id}/files/${file.id}`
      );
      if (res.ok) {
        const fullFile = await res.json();
        setSelectedFile(fullFile);
      } else {
        setSelectedFile(file);
      }
    } catch {
      setSelectedFile(file);
    }
    setPreviewOpen(true);
  }

  async function handleSaveEdit(fileId: string, content: string) {
    if (!project) return;
    setSavingFile(true);
    try {
      const res = await fetch(
        `/api/projects/${project.id}/files/${fileId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "保存文件失败");
      }
      const updated = await res.json();
      // Update file in local state
      setFiles((prev) =>
        prev.map((f) => (f.id === fileId ? updated : f))
      );
      setSelectedFile(updated);
      setPreviewOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存文件失败");
    } finally {
      setSavingFile(false);
    }
  }

  // --- Render: Loading state ---
  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-gray-400">加载中...</p>
      </div>
    );
  }

  // --- Render: Error state ---
  if (error && tabs.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <div className="mb-4 text-5xl">⚠️</div>
          <h2 className="mb-2 text-xl font-semibold text-gray-900">加载失败</h2>
          <p className="mb-6 text-sm text-gray-500">{error}</p>
          <button
            onClick={fetchTabs}
            className="inline-block rounded-md bg-gray-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-800 transition-colors"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  // --- Render: Workspace ---
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Top bar: breadcrumb + pipeline indicator + work record name */}
      <div className="flex items-center gap-2 border-b border-gray-200 bg-white px-4 py-2">
        <nav className="flex items-center gap-1 text-sm text-gray-500">
          <Link
            href="/projects"
            className="hover:text-gray-900 underline underline-offset-2 transition-colors"
          >
            项目列表
          </Link>
          {project && (
            <>
              <span>/</span>
              <Link
                href={`/projects/${project.id}`}
                className="hover:text-gray-900 underline underline-offset-2 transition-colors"
              >
                {project.name}
              </Link>
            </>
          )}
          <span>/</span>
          <span className="font-medium text-gray-900">
            {workRecord?.name || "工作台"}
          </span>
        </nav>

        {/* Pipeline progress indicator */}
        {activeTab && (
          <div className="ml-4">
            <PipelineProgressIndicator
              agentType={activeTab.agent_type}
              scopeFrozen={activeTab.scope_frozen}
            />
          </div>
        )}

        {creating && (
          <span className="ml-auto text-xs text-gray-400">创建中...</span>
        )}
      </div>

      {/* Main workspace area: file tree + context panel + chat */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: File tree */}
        <FileTree
          files={files}
          loading={filesLoading}
          error={filesError}
          selectedFileId={selectedFile?.id ?? null}
          onSelect={handleSelectFile}
          activeTabId={activeTabId}
          onLoadToAgent={handleLoadFileToContext}
          onEdit={handleEditFile}
          onDownload={handleDownloadFile}
        />

        {/* Agent context panel (only when a tab is active) */}
        {activeTabId && (
          <AgentContextPanel
            contextFiles={contextFiles}
            loading={contextLoading}
            onRemove={handleRemoveFileFromContext}
          />
        )}

        {/* Right: Tab bar + Chat area */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Tab bar */}
          <TabBar
            tabs={tabs}
            activeTabId={activeTabId}
            onSwitch={setActiveTabId}
            onClose={handleCloseTab}
            onRename={handleRenameTab}
            onNew={() => setShowAgentDialog(true)}
          />

          {/* Error banner (shown above content when stale data exists) */}
          {error && tabs.length > 0 && (
            <div className="mx-4 mt-2 rounded-md bg-red-50 px-4 py-2 text-sm text-red-600">
              {error}
              <button
                onClick={() => setError("")}
                className="ml-2 underline underline-offset-2"
              >
                关闭
              </button>
            </div>
          )}

          {/* Empty state: no tabs */}
          {!error && tabs.length === 0 ? (
            <div className="flex flex-1 items-center justify-center bg-gray-50">
              <div className="text-center">
                <div className="mb-4 text-5xl">🚀</div>
                <h2 className="mb-2 text-xl font-semibold text-gray-900">
                  新建一个标签页开始工作
                </h2>
                <p className="mb-6 text-sm text-gray-500">
                  选择一个 AI Agent 类型来启动您的第一个工作标签页
                </p>
                <ul className="mx-auto mb-6 max-w-sm space-y-2 text-left">
                  {AGENT_TYPES.map((type) => (
                    <li key={type}>
                      <button
                        onClick={() => handleCreateTab(type)}
                        disabled={creating}
                        className="w-full rounded-lg border border-gray-200 bg-white p-3 text-left hover:border-gray-400 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                      >
                        <div className="font-medium text-gray-900">
                          {AGENT_TYPE_LABELS[type]}
                        </div>
                        <div className="mt-0.5 text-xs text-gray-500">
                          {AGENT_TYPE_DESCRIPTIONS[type]}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            /* Chat area for active tab */
            <ChatArea
              tabId={activeTab?.id ?? null}
              tabName={activeTab?.display_name ?? null}
              agentType={activeTab?.agent_type ?? null}
              projectId={project?.id ?? null}
              onWorkRecordRenamed={(newName) => {
                setWorkRecord((prev) =>
                  prev ? { ...prev, name: newName } : prev
                );
              }}
              onFileSaved={fetchFiles}
            />
          )}
        </div>

        {/* Right: File preview panel */}
        <FilePreviewPanel
          file={selectedFile}
          open={previewOpen}
          saving={savingFile}
          onClose={() => setPreviewOpen(false)}
          onSaveEdit={handleSaveEdit}
          projectId={project?.id ?? ""}
        />
      </div>

      {/* Agent type selection dialog */}
      <AgentTypeDialog
        open={showAgentDialog}
        onClose={() => setShowAgentDialog(false)}
        onSelect={handleCreateTab}
      />
    </div>
  );
}
