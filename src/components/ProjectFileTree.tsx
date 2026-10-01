"use client";

import { useEffect, useRef, useState } from "react";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import DisclosureIcon from "@/components/DisclosureIcon";
import ProjectFileDetails from "@/components/ProjectFileDetails";
import { getWorkbenchFileStage } from "@/lib/workbench-file-branch";
import type { TaskFolderRestoreEntry } from "@/lib/mysql-task-folders";

export type ProjectFileEntry = { id: string; filename: string; version?: number; updated_at?: string; lastContentIteration?: string | null; canUndo?: boolean; deleted?: boolean; taskFolderId?: string | null; issueNumber?: number | null; taskOwnerIterationId?: string | null; taskArchived?: boolean };
type TaskFolderEntry = { id: string; iterationNumber: number; iterationName: string; ownerIterationId: string | null; archived: boolean; canUndo: boolean };

const branches = [
  { key: "analysis", label: "需求分析" },
  { key: "prototype", label: "原型" },
  { key: "prd", label: "PRD" },
  { key: "tickets", label: "任务拆分" },
] as const;

function taskFolder(file: ProjectFileEntry) {
  const parts = file.filename.split("/");
  if (parts.length === 2) return "未归属任务";
  const number = parts[1].match(/^iteration-(\d+)$/);
  return number ? `${file.taskFolderId ? "" : "未归属任务 · "}迭代 ${number[1].padStart(2, "0")}` : `旧版 ${parts[1]}`;
}

export default function ProjectFileTree({ projectId, iterationId, files, onChanged, onAddToContext, loadedFileIds = [], addDisabled = false, addDisabledReason }: {
  projectId: string;
  iterationId?: string;
  files: ProjectFileEntry[];
  onChanged?: () => void;
  onAddToContext?: (fileId: string) => void;
  loadedFileIds?: string[];
  addDisabled?: boolean;
  addDisabledReason?: string;
}) {
  const [selected, setSelected] = useState<ProjectFileEntry | null>(null);
  const [selectedDirectory, setSelectedDirectory] = useState(files);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [confirmUndo, setConfirmUndo] = useState(false);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState("");
  const [view, setView] = useState<"preview" | "details">("preview");
  const [reloadKey, setReloadKey] = useState(0);
  const [taskFolders, setTaskFolders] = useState<TaskFolderEntry[]>([]);
  const [folderLoading, setFolderLoading] = useState(true);
  const [folderError, setFolderError] = useState("");
  const [folderOperationError, setFolderOperationError] = useState("");
  const [folderRestoreResult, setFolderRestoreResult] = useState<{ folderId: string; entries: TaskFolderRestoreEntry[] } | null>(null);
  const [folderWorking, setFolderWorking] = useState(false);
  const [confirmFolderRestore, setConfirmFolderRestore] = useState<string | null>(null);
  const [folderRevision, setFolderRevision] = useState(0);
  const opener = useRef<HTMLButtonElement | null>(null);
  const closeButton = useRef<HTMLButtonElement | null>(null);
  const selectedFileId = selected?.id;
  const canChangeSelected = Boolean(iterationId && selected && (selected.taskFolderId
    ? selected.taskOwnerIterationId === iterationId && !selected.taskArchived
    : getWorkbenchFileStage(selected.filename) !== "tickets"));

  // 整套撤回后目录异步刷新：已打开的删除占位也必须恢复为当前文件，不能卡在旧详情。
  if (selectedDirectory !== files) {
    setSelectedDirectory(files);
    if (selected) {
      const refreshed = files.find((file) => file.id === selected.id);
      if (refreshed) {
        setSelected({ ...selected, ...refreshed });
        if (Boolean(refreshed.deleted) !== Boolean(selected.deleted)) {
          setView(refreshed.deleted ? "details" : "preview");
        }
      }
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/projects/${projectId}/task-folders`, { signal: controller.signal })
      .then(async (response) => {
        const body: TaskFolderEntry[] & { error?: string } = await response.json();
        if (!response.ok) throw new Error(body.error || "任务文件夹加载失败");
        if (!controller.signal.aborted) {
          setTaskFolders(body); setFolderError("");
          setFolderRestoreResult((result) => result && body.some((folder) => folder.id === result.folderId && folder.canUndo) ? null : result);
        }
      })
      .catch((caught) => { if (!controller.signal.aborted) setFolderError(caught instanceof Error ? caught.message : "任务文件夹加载失败"); })
      .finally(() => { if (!controller.signal.aborted) setFolderLoading(false); });
    return () => controller.abort();
  }, [projectId, folderRevision, files]);

  async function changeFolder(action: "create" | "restore", folderId?: string) {
    if (!iterationId || folderWorking) return;
    setFolderWorking(true); setFolderOperationError(""); setFolderRestoreResult(null);
    try {
      const response = await fetch(`/api/iterations/${iterationId}/task-folder`, {
        method: action === "create" ? "POST" : "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, ...(folderId ? { folderId, action: "restore" } : {}) }),
      });
      const body = await response.json();
      if (!response.ok) {
        if (response.status === 409) setFolderRevision((value) => value + 1);
        throw new Error(body.error || "任务文件夹操作失败");
      }
      if (action === "restore") {
        setFolderRestoreResult({ folderId: body.folderId, entries: body.entries });
        setTaskFolders((folders) => folders.map((folder) => folder.id === folderId ? { ...folder, canUndo: false } : folder));
      }
      setConfirmFolderRestore(null);
      setFolderLoading(true);
      setFolderRevision((value) => value + 1);
      onChanged?.();
      if (selected?.taskFolderId === folderId) { setSelected(null); setContent(""); }
    } catch (caught) { setFolderOperationError(caught instanceof Error ? caught.message : "任务文件夹操作失败"); }
    finally { setFolderWorking(false); }
  }

  function close() {
    if (working) return;
    setSelected(null);
    opener.current?.focus();
  }

  useEffect(() => {
    if (!selected) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !working) { setSelected(null); opener.current?.focus(); }
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selected, working]);

  useEffect(() => {
    if (!selectedFileId || selected?.deleted) return;
    const controller = new AbortController();
    void fetch(`/api/projects/${projectId}/files/${selectedFileId}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "文件打开失败");
        setContent(body.content);
        setSelected((current) => current?.id === selectedFileId && current.canUndo !== Boolean(body.canUndo)
          ? { ...current, canUndo: Boolean(body.canUndo) } : current);
      })
      .catch((caught) => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "文件打开失败"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [projectId, selectedFileId, selected?.deleted, selected?.version, reloadKey]);

  function open(file: ProjectFileEntry, button?: HTMLButtonElement) {
    if (button) opener.current = button;
    setContent("");
    setError("");
    setLoading(!file.deleted);
    setEditing(false);
    setConfirmUndo(false);
    setNotice("");
    setView(file.deleted ? "details" : "preview");
    setSelected({ ...file });
    setReloadKey((key) => key + 1);
    window.setTimeout(() => closeButton.current?.focus(), 0);
  }

  async function changeRevision(action: "edit" | "restore") {
    if (!selected || !iterationId || working) return;
    setWorking(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/iterations/${iterationId}/files/${selected.id}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, action, ...(action === "edit" ? { content: draft } : {}) }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "文件操作失败，请重试");
      setContent(body.content);
      setSelected((current) => current ? { ...current, canUndo: body.canUndo } : current);
      setEditing(false);
      setConfirmUndo(false);
      setNotice(action === "restore" ? "已撤回到上一版；本次撤回不能重做。" : "修改已保存，可撤回到修改前的正文。");
      if (selected.taskFolderId) { setFolderLoading(true); setFolderRevision((value) => value + 1); }
      onChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "文件操作失败，请重试");
    } finally { setWorking(false); }
  }

  function renderFile(file: ProjectFileEntry) {
    const name = file.filename.split("/").at(-1) ?? file.filename;
    const loaded = loadedFileIds.includes(file.id);
    const revisionState = file.taskFolderId
      ? file.taskArchived ? "只读归档" : file.taskOwnerIterationId === iterationId ? file.canUndo ? "可整套撤回" : "暂无整套撤回" : "只读"
      : file.canUndo ? "可撤回" : "不可撤回";
    return <div className="project-tree-file" key={file.id}>
      <button type="button" className={`project-tree-name${file.deleted ? " deleted" : ""}`} title={file.filename} onClick={(event) => open(file, event.currentTarget)}><svg className="project-tree-file-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M5 2.5h6l4 4v11H5z M11 2.5v4h4 M8 10h4 M8 13h4" /></svg><span className="project-tree-label"><strong>{name}</strong><small>{file.deleted ? "已删除 · 查看来源记录" : `最近写入：${file.lastContentIteration ?? "未记录"} · ${revisionState}`}</small></span></button>
      {onAddToContext && !file.deleted && <button
        type="button"
        className="project-tree-add-context"
        disabled={loaded || addDisabled}
        title={loaded ? "已加入当前上下文" : addDisabledReason}
        aria-label={loaded ? `已加入当前上下文：${file.filename}` : `加入当前上下文：${file.filename}`}
        onClick={() => onAddToContext(file.id)}
      >{loaded ? "已加入" : "加入上下文"}</button>}
    </div>;
  }

  return <>
    <div className="project-tree" aria-label="项目文件树">
      {branches.map((branch) => {
        const entries = files.filter((file) => getWorkbenchFileStage(file.filename) === branch.key).sort((a, b) => a.filename.localeCompare(b.filename, "zh-CN", { numeric: true }));
        const folders = branch.key === "tickets" ? [...new Set(entries.map(taskFolder))] : [];
        const ownFolder = taskFolders.find((folder) => folder.ownerIterationId === iterationId);
        return <details className="project-tree-branch" key={branch.key} open>
          <summary className="disclosure-summary"><span>{branch.label}</span><small>{entries.length}</small><DisclosureIcon /></summary>
          {branch.key === "tickets" ? <>
            {folderError && <p className="project-file-revision-error" role="alert">{folderError} <button type="button" onClick={() => { setFolderLoading(true); setFolderRevision((value) => value + 1); }}>重试</button></p>}
            {folderOperationError && <p className="project-file-revision-error" role="alert">{folderOperationError} 请重试原操作。</p>}
            {iterationId && !ownFolder && !folderError && !folderLoading && <button type="button" className="task-folder-create" disabled={folderWorking} onClick={() => void changeFolder("create")}>{folderWorking ? "创建中…" : "为本迭代建立任务文件夹"}</button>}
            {folderLoading && <p className="project-tree-empty" role="status">正在加载任务文件夹…</p>}
            {[...new Set([...taskFolders.map((folder) => `迭代 ${String(folder.iterationNumber).padStart(2, "0")}`), ...folders])].map((label) => {
              const folder = taskFolders.find((item) => `迭代 ${String(item.iterationNumber).padStart(2, "0")}` === label);
              const editableFolder = folder?.ownerIterationId === iterationId ? folder : null;
              const children = entries.filter((file) => taskFolder(file) === label && (!folder || file.taskFolderId === folder.id));
              const state = folder?.archived ? "已删除迭代 · 只读归档" : folder?.ownerIterationId === iterationId ? "本迭代 · 可修改" : "其他迭代 · 只读";
              const restoreResult = folderRestoreResult?.folderId === folder?.id ? folderRestoreResult : null;
              return <details className="project-tree-folder" key={label} open><summary className="disclosure-summary"><span className="task-folder-heading"><strong>{label}</strong><em>{folder ? state : folderLoading ? "归属加载中…" : "旧任务 · 只读"}</em></span><small>{children.filter((file) => !file.deleted).length} 个 issue</small><DisclosureIcon /></summary>
                {editableFolder && <div className="task-folder-actions">{editableFolder.canUndo && confirmFolderRestore === editableFolder.id ? <div className="project-file-undo-confirm task-folder-undo-confirm">
                  <p>撤回迭代 {String(editableFolder.iterationNumber).padStart(2, "0")} 的上次任务修改，将整套恢复修改前的集合：移除新增 issue、恢复被删 issue、还原正文与文件名。</p>
                  <p>撤回会消耗唯一旧集合，本次撤回不能重做。</p>
                  <div><button type="button" disabled={folderWorking} onClick={() => { setConfirmFolderRestore(null); setFolderOperationError(""); }}>取消</button><button type="button" disabled={folderWorking || folderLoading || Boolean(folderError)} onClick={() => void changeFolder("restore", editableFolder.id)}>{folderWorking ? "撤回中…" : "确认撤回整套"}</button></div>
                </div> : <><button type="button" disabled={!editableFolder.canUndo || folderWorking || folderLoading || Boolean(folderError)} onClick={() => { setConfirmFolderRestore(editableFolder.id); setFolderOperationError(""); setFolderRestoreResult(null); }}>撤回上次任务修改</button>{!editableFolder.canUndo && <span>没有可撤回的旧集合。</span>}</>}</div>}
                {restoreResult && <div className="task-folder-restore-result" role="status">
                  <p>整套任务已恢复。旧集合已消耗，本次撤回不能重做。</p>
                  <div className="task-set-summary" aria-label="整套恢复汇总">
                    <span>恢复被删 <strong>{restoreResult.entries.filter((entry) => entry.change === "restored").length}</strong></span>
                    <span>还原正文 <strong>{restoreResult.entries.filter((entry) => entry.change === "content").length}</strong></span>
                    <span>恢复文件名 <strong>{restoreResult.entries.filter((entry) => entry.renamed).length}</strong></span>
                    <span>移除新增 <strong>{restoreResult.entries.filter((entry) => entry.change === "removed").length}</strong></span>
                  </div>
                  <details><summary className="disclosure-summary">查看恢复明细<DisclosureIcon /></summary><div className="task-set-list">{restoreResult.entries.map((entry) => <div className="task-set-row" key={entry.id}><div className="task-set-row-head"><span>{entry.change === "removed" ? "移除新增" : entry.change === "restored" ? "恢复被删" : entry.change === "content" ? entry.renamed ? "还原正文与文件名" : "还原正文" : entry.change === "rename" ? "恢复文件名" : "保持不变"}</span><strong title={entry.filename}>{entry.filename.split("/").at(-1)}</strong></div></div>)}</div></details>
                </div>}
                {children.map(renderFile)}{!children.length && <p className="project-tree-empty">暂无 issue</p>}
              </details>;
            })}
            {!folderLoading && !taskFolders.length && !folders.length && !iterationId && <p className="project-tree-empty">暂无任务文件夹</p>}
          </> : entries.map(renderFile)}
          {!entries.length && branch.key !== "tickets" && <p className="project-tree-empty">暂无文件</p>}
        </details>;
      })}
    </div>
    {selected && <div className="project-file-preview-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section className="project-file-preview" role="dialog" aria-modal="true" aria-label={`${selected.deleted ? "详情" : "预览"} ${selected.filename}`} onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const focusables = [...event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], textarea:not(:disabled)")];
        const first = focusables[0];
        const last = focusables.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}>
        <header><div><span>项目文件 / {branches.find((branch) => branch.key === getWorkbenchFileStage(selected.filename))?.label}</span><h2>{selected.filename}</h2></div><button ref={closeButton} type="button" aria-label="关闭预览" title="关闭预览" onClick={close}><svg className="project-file-action-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10 M15 5 5 15" /></svg></button></header>
        <div className="project-file-view-switch" role="tablist" aria-label="文件视图">{!selected.deleted && <button type="button" role="tab" aria-selected={view === "preview"} onClick={() => setView("preview")}>正文预览</button>}<button type="button" role="tab" aria-selected={view === "details"} onClick={() => setView("details")}>文件详情与来源</button></div>
        <div className="project-file-preview-body">
          {view === "details" ? <ProjectFileDetails projectId={projectId} iterationId={iterationId} file={selected} onChanged={() => { onChanged?.(); if (selected.taskFolderId) { setFolderLoading(true); setFolderRevision((value) => value + 1); } }} onIdentityChanged={(change) => { setSelected((current) => current ? { ...current, filename: change.filename, deleted: change.deleted, canUndo: change.deleted ? false : current.canUndo } : current); if (change.deleted) { setContent(""); setView("details"); } }} /> :
          loading ? <p role="status">正在打开文件…</p> : <>
            {notice && <p className="project-file-revision-notice" role="status">{notice}</p>}
            {error && <p className="project-file-revision-error" role="alert">{error}{!editing && !confirmUndo && !content ? <> <button type="button" onClick={() => open(selected)}>重试</button></> : null}</p>}
            {editing ? <div className="project-file-edit"><label htmlFor="project-file-content">Markdown 正文</label><textarea id="project-file-content" value={draft} disabled={working} onChange={(event) => setDraft(event.target.value)} /><div className="project-file-edit-actions"><button type="button" disabled={working} onClick={() => { setEditing(false); setError(""); }}>取消</button><button type="button" disabled={working || draft === content} onClick={() => void changeRevision("edit")}>{working ? "保存中…" : "保存修改"}</button></div></div> : content || !error ? <MarkdownRenderer content={content} /> : null}
            {confirmUndo && !editing && <div className="project-file-undo-confirm"><p>撤回后，上一版会成为当前正文，这次撤回不能重做。</p><div><button type="button" disabled={working} onClick={() => { setConfirmUndo(false); setError(""); }}>取消</button><button type="button" disabled={working} onClick={() => void changeRevision("restore")}>{working ? "撤回中…" : "确认撤回"}</button></div></div>}
          </>}
        </div>
        {view === "preview" && !selected.deleted && <footer><span>{selected.taskFolderId ? selected.taskArchived ? "已删除迭代 · 只读归档" : canChangeSelected ? "本迭代任务 · 可修改" : "其他迭代任务 · 只读" : canChangeSelected ? selected.canUndo ? "可撤回到上一版" : "没有可撤回的上一版" : "Markdown 预览"}</span><div className="project-file-preview-actions">{canChangeSelected && !loading && !editing && !confirmUndo && <><button type="button" disabled={working || Boolean(error)} onClick={() => { setDraft(content); setEditing(true); setNotice(""); }}>编辑正文</button>{!selected.taskFolderId && <button type="button" disabled={working || !selected.canUndo || Boolean(error)} onClick={() => { setConfirmUndo(true); setNotice(""); }}>撤回上次修改</button>}</>}<a href={`/api/projects/${projectId}/files/${selected.id}/download`} aria-label={`下载 ${selected.filename}`}><svg className="project-file-action-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3v9 m-4-4 4 4 4-4 M4 14v3h12v-3" /></svg>下载 Markdown</a></div></footer>}
      </section>
    </div>}
  </>;
}
