"use client";

import { useEffect, useRef, useState } from "react";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import DisclosureIcon from "@/components/DisclosureIcon";
import { getWorkbenchFileStage } from "@/lib/workbench-file-branch";

export type ProjectFileEntry = { id: string; filename: string; version?: number; updated_at?: string; lastContentIteration?: string | null; canUndo?: boolean };

const branches = [
  { key: "analysis", label: "需求分析" },
  { key: "prototype", label: "原型" },
  { key: "prd", label: "PRD" },
  { key: "tickets", label: "任务拆分" },
] as const;

function taskFolder(path: string) {
  const parts = path.split("/");
  if (parts.length === 2) return "未归属任务";
  const number = parts[1].match(/^iteration-(\d+)$/);
  return number ? `迭代 ${number[1].padStart(2, "0")}` : `旧版 ${parts[1]}`;
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
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [confirmUndo, setConfirmUndo] = useState(false);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const opener = useRef<HTMLButtonElement | null>(null);
  const closeButton = useRef<HTMLButtonElement | null>(null);
  const selectedFileId = selected?.id;

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
    if (!selectedFileId) return;
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
  }, [projectId, selectedFileId, reloadKey]);

  function open(file: ProjectFileEntry, button?: HTMLButtonElement) {
    if (button) opener.current = button;
    setContent("");
    setError("");
    setLoading(true);
    setEditing(false);
    setConfirmUndo(false);
    setNotice("");
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
      onChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "文件操作失败，请重试");
    } finally { setWorking(false); }
  }

  function renderFile(file: ProjectFileEntry) {
    const name = file.filename.split("/").at(-1) ?? file.filename;
    const loaded = loadedFileIds.includes(file.id);
    return <div className="project-tree-file" key={file.id}>
      <button type="button" className="project-tree-name" title={file.filename} onClick={(event) => open(file, event.currentTarget)}><span aria-hidden="true">▤</span><span className="project-tree-label"><strong>{name}</strong><small>最近写入：{file.lastContentIteration ?? "未记录"} · {file.canUndo ? "可撤回" : "不可撤回"}</small></span></button>
      {onAddToContext && <button
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
        const folders = branch.key === "tickets" ? [...new Set(entries.map((file) => taskFolder(file.filename)))] : [];
        return <details className="project-tree-branch" key={branch.key} open>
          <summary className="disclosure-summary"><span>{branch.label}</span><small>{entries.length}</small><DisclosureIcon /></summary>
          {branch.key === "tickets" ? folders.map((folder) => <details className="project-tree-folder" key={folder} open><summary className="disclosure-summary"><span>{folder}</span><small>{entries.filter((file) => taskFolder(file.filename) === folder).length}</small><DisclosureIcon /></summary>{entries.filter((file) => taskFolder(file.filename) === folder).map(renderFile)}</details>) : entries.map(renderFile)}
          {!entries.length && <p className="project-tree-empty">暂无文件</p>}
        </details>;
      })}
    </div>
    {selected && <div className="project-file-preview-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section className="project-file-preview" role="dialog" aria-modal="true" aria-label={`预览 ${selected.filename}`} onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const focusables = [...event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], textarea:not(:disabled)")];
        const first = focusables[0];
        const last = focusables.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}>
        <header><div><span>项目文件 / {branches.find((branch) => branch.key === getWorkbenchFileStage(selected.filename))?.label}</span><h2>{selected.filename}</h2></div><button ref={closeButton} type="button" aria-label="关闭预览" title="关闭预览" onClick={close}>×</button></header>
        <div className="project-file-preview-body">
          {loading ? <p role="status">正在打开文件…</p> : <>
            {notice && <p className="project-file-revision-notice" role="status">{notice}</p>}
            {error && <p className="project-file-revision-error" role="alert">{error}{!editing && !confirmUndo && !content ? <> <button type="button" onClick={() => open(selected)}>重试</button></> : null}</p>}
            {editing ? <div className="project-file-edit"><label htmlFor="project-file-content">Markdown 正文</label><textarea id="project-file-content" value={draft} disabled={working} onChange={(event) => setDraft(event.target.value)} /><div className="project-file-edit-actions"><button type="button" disabled={working} onClick={() => { setEditing(false); setError(""); }}>取消</button><button type="button" disabled={working || draft === content} onClick={() => void changeRevision("edit")}>{working ? "保存中…" : "保存修改"}</button></div></div> : content || !error ? <MarkdownRenderer content={content} /> : null}
            {confirmUndo && !editing && <div className="project-file-undo-confirm"><p>撤回后，上一版会成为当前正文，这次撤回不能重做。</p><div><button type="button" disabled={working} onClick={() => { setConfirmUndo(false); setError(""); }}>取消</button><button type="button" disabled={working} onClick={() => void changeRevision("restore")}>{working ? "撤回中…" : "确认撤回"}</button></div></div>}
          </>}
        </div>
        <footer><span>{iterationId && getWorkbenchFileStage(selected.filename) !== "tickets" ? selected.canUndo ? "可撤回到上一版" : "没有可撤回的上一版" : "Markdown 预览"}</span><div className="project-file-preview-actions">{iterationId && getWorkbenchFileStage(selected.filename) !== "tickets" && !loading && !editing && !confirmUndo && <><button type="button" disabled={working || Boolean(error)} onClick={() => { setDraft(content); setEditing(true); setNotice(""); }}>编辑正文</button><button type="button" disabled={working || !selected.canUndo || Boolean(error)} onClick={() => { setConfirmUndo(true); setNotice(""); }}>撤回上次修改</button></>}<a href={`/api/projects/${projectId}/files/${selected.id}/download`} aria-label={`下载 ${selected.filename}`}>↓ 下载 Markdown</a></div></footer>
      </section>
    </div>}
  </>;
}
