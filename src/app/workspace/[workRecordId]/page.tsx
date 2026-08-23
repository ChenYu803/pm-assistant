"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import TabBar from "@/components/TabBar";
import ChatArea from "@/components/ChatArea";
import AgentTypeDialog from "@/components/AgentTypeDialog";
import InlineNameInput from "@/components/InlineNameInput";
import FileTree from "@/components/FileTree";
import FilePreviewPanel from "@/components/FilePreviewPanel";
import PipelineProgressIndicator from "@/components/PipelineProgressIndicator";
import AgentContextPanel, { type ContextFile } from "@/components/AgentContextPanel";
import {
  AGENT_TYPE_METADATA,
  PIPELINE_AGENT_TYPES,
  type AgentType,
} from "@/lib/agent-constants";
import type { TabData } from "@/lib/agent-constants";
import type { ProjectFileData } from "@/lib/file-helpers";
import { downloadFilename } from "@/lib/file-helpers";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

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

function createTabRequestId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
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
  // 关闭标签页确认弹窗的目标
  const [pendingCloseTab, setPendingCloseTab] = useState<TabData | null>(null);
  // 删除文件确认弹窗的目标
  const [pendingDeleteFile, setPendingDeleteFile] = useState<ProjectFileData | null>(null);
  const [deletingFile, setDeletingFile] = useState(false);
  const [workRecord, setWorkRecord] = useState<WorkRecord | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  // 顶栏工作记录名是否处于行内改名状态（点击名称进入）
  const [renamingRecord, setRenamingRecord] = useState(false);
  // 空状态锁定步骤点击的轻提示文案（auto-clear）
  const [lockedStepHint, setLockedStepHint] = useState("");

  // File tree state
  const [files, setFiles] = useState<ProjectFileData[]>([]);
  // 初始为 true：project 加载完成前文件列表视为「未就绪」，
  // ChatArea 据此延迟扫描历史消息，避免误弹已写入文件的确认框
  const [filesLoading, setFilesLoading] = useState(true);
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
    const refresh = window.setTimeout(() => {
      void fetchContextFiles();
    }, 0);
    return () => window.clearTimeout(refresh);
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

  /** Open a file in the preview panel, fetching its full content first. */
  async function openFileFull(file: ProjectFileData) {
    if (!project) return;
    // File list omits content — fetch full file from detail endpoint
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

  async function handleEditFile(file: ProjectFileData) {
    await openFileFull(file);
  }

  function handleDownloadFile(file: ProjectFileData) {
    if (!project) return;
    const a = document.createElement("a");
    a.href = `/api/projects/${project.id}/files/${file.id}/download`;
    // 子路径文件名（issues/…）下载时取文件名段（download 属性不支持路径分隔符）
    a.download = downloadFilename(file.filename);
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
      const refresh = window.setTimeout(() => {
        void fetchFiles();
      }, 0);
      return () => window.clearTimeout(refresh);
    }
  }, [project, fetchFiles]);

  useEffect(() => {
    const refresh = window.setTimeout(() => {
      void fetchTabs();
    }, 0);
    return () => window.clearTimeout(refresh);
  }, [fetchTabs]);

  // Restore active tab from localStorage when tabs change
  useEffect(() => {
    const restore = window.setTimeout(() => {
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
    }, 0);
    return () => window.clearTimeout(restore);
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
      const newTab: TabData = responseData.tab;
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

  /** 顶栏改名：PATCH 后更新本地工作记录名（AI 自动命名只对「未命名」生效，
   *  手动改名后不再覆盖——auto-name 服务端判定，此处无需额外处理）。 */
  async function handleRenameRecord(newName: string) {
    setRenamingRecord(false);
    const trimmed = newName.trim();
    if (!trimmed) return;
    try {
      const res = await fetch(`/api/work-records/${workRecordId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "改名失败");
      }
      const updated = await res.json();
      setWorkRecord(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "改名失败");
    }
  }

  async function handleRenameTab(tabId: string, newName: string) {
    const tab = tabs.find((item) => item.id === tabId);
    if (!tab) return;

    try {
      const res = await fetch(`/api/tabs/${tabId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: newName,
          expectedVersion: tab.version,
          requestId: createTabRequestId("rename"),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "重命名失败");
      }
      const updated = await res.json();
      setTabs((prev) =>
        prev.map((item) => (item.id === tabId ? updated : item))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "重命名失败");
    }
  }

  /** 点击关闭按钮 → 打开确认弹窗。 */
  function requestCloseTab(tabId: string) {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;
    setPendingCloseTab(tab);
  }

  /** 确认弹窗的「关闭」动作：删除该标签页及其聊天记录。 */
  async function confirmCloseTab() {
    const tab = pendingCloseTab;
    if (!tab) return;
    setPendingCloseTab(null);

    // Optimistic removal
    const wasActive = tab.id === activeTabId;
    setTabs((prev) => prev.filter((t) => t.id !== tab.id));

    try {
      const res = await fetch(`/api/tabs/${tab.id}`, { method: "DELETE" });
      if (!res.ok) {
        throw new Error("删除失败");
      }
    } catch {
      await fetchTabs();
      return;
    }

    // Switch to another tab if we closed the active one.
    // Side effects stay outside the setTabs updater (StrictMode double-invokes).
    if (wasActive) {
      const remaining = tabs.filter((t) => t.id !== tab.id);
      if (remaining.length > 0) {
        localStorage.setItem(storageKey, remaining[0].id);
        setActiveTabId(remaining[0].id);
      } else {
        localStorage.removeItem(storageKey);
        setActiveTabId(null);
      }
    }
  }

  function handleSelectFile(file: ProjectFileData) {
    void openFileFull(file);
  }

  /** 点击删除按钮 → 打开确认弹窗。 */
  function requestDeleteFile(file: ProjectFileData) {
    setPendingDeleteFile(file);
  }

  /** 确认弹窗的「删除」动作：删除文件并清理引用。 */
  async function confirmDeleteFile() {
    const file = pendingDeleteFile;
    if (!file || !project) return;
    setDeletingFile(true);
    try {
      const res = await fetch(
        `/api/projects/${project.id}/files/${file.id}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "删除文件失败");
      }
      // 文件树刷新（fetchFiles 会自动清掉已删除文件的预览状态）
      await fetchFiles();
      // 刷新当前标签页的上下文面板，移除已删除文件的引用
      if (activeTabId) await fetchContextFiles();
      setPendingDeleteFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除文件失败");
      setPendingDeleteFile(null);
    } finally {
      setDeletingFile(false);
    }
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
          <h2 className="mb-2 text-xl font-semibold">加载失败</h2>
          <p className="mb-6 text-sm text-muted-foreground">{error}</p>
          <Button size="lg" onClick={fetchTabs}>
            重试
          </Button>
        </div>
      </div>
    );
  }

  // --- Render: Workspace ---
  return (
    // min-h-0：允许高度收缩到视口内，聊天区才有独立的滚动容器
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
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
          {renamingRecord ? (
            <InlineNameInput
              value={workRecord?.name ?? "工作台"}
              onSubmit={handleRenameRecord}
              onCancel={() => setRenamingRecord(false)}
              className="w-44"
            />
          ) : (
            <button
              type="button"
              onClick={() => setRenamingRecord(true)}
              title="点击改名"
              className="rounded px-1 font-medium text-gray-900 transition-colors hover:bg-gray-100"
            >
              {workRecord?.name || "工作台"}
            </button>
          )}
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
      <div className="flex min-h-0 flex-1 overflow-hidden">
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
          onDelete={requestDeleteFile}
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
            onClose={requestCloseTab}
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

          {/* Empty state: no tabs — 四步流水线全景（v1.1 空状态引导） */}
          {!error && tabs.length === 0 ? (
            <div className="flex flex-1 items-center justify-center overflow-y-auto bg-gray-50">
              <div className="px-6 py-10 text-center">
                <div className="mb-4 text-5xl">🚀</div>
                <h2 className="mb-2 text-xl font-semibold text-gray-900">
                  从一个想法开始，四步走完产品闭环
                </h2>
                <p className="mb-2 text-sm text-gray-500">
                  按流水线顺序完成每一步，前一步的产出自动交给下一步
                </p>
                <p className="mb-8 text-xs text-gray-400">
                  点击「需求分析」创建第一个标签页；已有标签页后可用右上角「+」选择任意 Agent
                </p>

                {/* 流水线全景：仅首步（需求分析）可点击创建，后三步锁定 */}
                <div className="flex flex-wrap items-stretch justify-center gap-3">
                  {PIPELINE_AGENT_TYPES.map((type, index) => {
                    const locked = index > 0;
                    return (
                      <div key={type} className="flex items-center gap-3">
                        {index > 0 && (
                          <div className="hidden text-xl text-gray-300 sm:block">
                            →
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            if (locked) {
                              // 轻提示：锁定步骤点击提示原因
                              setLockedStepHint(
                                `「${AGENT_TYPE_METADATA[type].label}」完成前置步骤后开启`
                              );
                              setTimeout(() => setLockedStepHint(""), 2500);
                              return;
                            }
                            handleCreateTab(type);
                          }}
                          disabled={creating}
                          className={`flex w-44 flex-col items-center gap-1.5 rounded-xl border p-4 transition-colors ${
                            locked
                              ? "cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400"
                              : "border-indigo-200 bg-white hover:border-indigo-400 hover:bg-indigo-50"
                          }`}
                        >
                          <span className="text-3xl" aria-hidden="true">
                            {AGENT_TYPE_METADATA[type].icon}
                          </span>
                          <span className="text-sm font-medium">
                            {AGENT_TYPE_METADATA[type].pipelineLabel}
                          </span>
                          <span className="text-xs leading-relaxed text-gray-500">
                            {AGENT_TYPE_METADATA[type].responsibility}
                          </span>
                          {locked && (
                            <span className="mt-1 flex items-center gap-1 text-xs text-gray-400">
                              🔒 完成前置步骤后开启
                            </span>
                          )}
                          {!locked && (
                            <span className="mt-1 text-xs font-medium text-indigo-600">
                              ← 从这里开始
                            </span>
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>

                {/* 锁定步骤轻提示 */}
                {lockedStepHint && (
                  <div className="mx-auto mt-6 max-w-sm rounded-md bg-gray-800 px-4 py-2 text-xs text-white">
                    {lockedStepHint}
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Chat area for active tab */
            <ChatArea
              tabId={activeTab?.id ?? null}
              tabName={activeTab?.display_name ?? null}
              tabVersion={activeTab?.version ?? null}
              freezeStatus={activeTab?.freeze_status ?? null}
              freezeMessageId={activeTab?.freeze_message_id}
              freezeError={activeTab?.freeze_error}
              agentType={activeTab?.agent_type ?? null}
              projectId={project?.id ?? null}
              existingFileNames={files.map((f) => f.filename)}
              filesReady={!filesLoading}
              onWorkRecordRenamed={(newName) => {
                setWorkRecord((prev) =>
                  prev ? { ...prev, name: newName } : prev
                );
              }}
              onFileSaved={fetchFiles}
              onTabVersionChange={(tabId, version) => {
                setTabs((prev) =>
                  prev.map((tab) =>
                    tab.id === tabId ? { ...tab, version } : tab
                  )
                );
              }}
              onTabConflict={() => {
                void fetchTabs();
              }}
              onTabFreezeStateChange={(tabId, state) => {
                setTabs((prev) =>
                  prev.map((tab) =>
                    tab.id === tabId
                      ? {
                          ...tab,
                          freeze_status: state.freezeStatus,
                          scope_frozen: state.scopeFrozen ?? tab.scope_frozen,
                          ...(state.freezeMessageId
                            ? { freeze_message_id: state.freezeMessageId }
                            : { freeze_message_id: undefined }),
                          ...(state.freezeError
                            ? { freeze_error: state.freezeError }
                            : { freeze_error: undefined }),
                          ...(typeof state.version === "number"
                            ? { version: state.version }
                            : {}),
                        }
                      : tab
                  )
                );
              }}
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

      {/* 删除文件确认弹窗 */}
      <AlertDialog
        open={pendingDeleteFile !== null}
        onOpenChange={(o) => {
          if (!o && !deletingFile) setPendingDeleteFile(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>确定删除该文件？</AlertDialogTitle>
          <AlertDialogDescription>
            文件「{pendingDeleteFile?.filename}」将被永久删除，此操作不可恢复。
            若该文件已加载到 Agent 上下文，相关引用也会一并清理。
          </AlertDialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <AlertDialogCancel asChild>
              <Button variant="outline" disabled={deletingFile}>取消</Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                variant="destructive"
                onClick={confirmDeleteFile}
                disabled={deletingFile}
              >
                {deletingFile ? "删除中..." : "删除"}
              </Button>
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>

      {/* 关闭标签页确认弹窗 */}
      <AlertDialog
        open={pendingCloseTab !== null}
        onOpenChange={(o) => {
          if (!o) setPendingCloseTab(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>确定关闭该标签页？</AlertDialogTitle>
          <AlertDialogDescription>
            标签页「{pendingCloseTab?.display_name}」的聊天记录将被永久删除，此操作不可恢复。
          </AlertDialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <AlertDialogCancel asChild>
              <Button variant="outline">取消</Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button variant="destructive" onClick={confirmCloseTab}>
                关闭
              </Button>
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
