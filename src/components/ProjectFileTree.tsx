"use client";

import { useEffect, useRef, useState } from "react";
import MarkdownRenderer from "@/components/MarkdownRenderer";
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

export default function ProjectFileTree({ projectId, files }: {
  projectId: string;
  files: ProjectFileEntry[];
}) {
  const [selected, setSelected] = useState<ProjectFileEntry | null>(null);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const opener = useRef<HTMLButtonElement | null>(null);
  const closeButton = useRef<HTMLButtonElement | null>(null);

  function close() {
    setSelected(null);
    opener.current?.focus();
  }

  useEffect(() => {
    if (!selected) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") { setSelected(null); opener.current?.focus(); }
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selected]);

  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    void fetch(`/api/projects/${projectId}/files/${selected.id}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "文件打开失败");
        setContent(body.content);
      })
      .catch((caught) => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "文件打开失败"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [projectId, selected]);

  function open(file: ProjectFileEntry, button?: HTMLButtonElement) {
    if (button) opener.current = button;
    setContent("");
    setError("");
    setLoading(true);
    setSelected({ ...file });
    window.setTimeout(() => closeButton.current?.focus(), 0);
  }

  function renderFile(file: ProjectFileEntry) {
    const name = file.filename.split("/").at(-1) ?? file.filename;
    return <div className="project-tree-file" key={file.id}>
      <button type="button" className="project-tree-name" title={file.filename} onClick={(event) => open(file, event.currentTarget)}><span aria-hidden="true">▤</span><span className="project-tree-label"><strong>{name}</strong><small>最近写入：{file.lastContentIteration ?? "未记录"} · {file.canUndo ? "可撤回" : "不可撤回"}</small></span></button>
      <span className="project-tree-version">{file.version ? `r${file.version}` : ""}</span>
    </div>;
  }

  return <>
    <div className="project-tree" aria-label="项目文件树">
      {branches.map((branch) => {
        const entries = files.filter((file) => getWorkbenchFileStage(file.filename) === branch.key).sort((a, b) => a.filename.localeCompare(b.filename, "zh-CN", { numeric: true }));
        const folders = branch.key === "tickets" ? [...new Set(entries.map((file) => taskFolder(file.filename)))] : [];
        return <details className="project-tree-branch" key={branch.key} open>
          <summary><span>{branch.label}</span><small>{entries.length}</small></summary>
          {branch.key === "tickets" ? folders.map((folder) => <details className="project-tree-folder" key={folder} open><summary><span>{folder}</span><small>{entries.filter((file) => taskFolder(file.filename) === folder).length}</small></summary>{entries.filter((file) => taskFolder(file.filename) === folder).map(renderFile)}</details>) : entries.map(renderFile)}
          {!entries.length && <p className="project-tree-empty">暂无文件</p>}
        </details>;
      })}
    </div>
    {selected && <div className="project-file-preview-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section className="project-file-preview" role="dialog" aria-modal="true" aria-label={`预览 ${selected.filename}`} onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const focusables = [...event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), a[href]")];
        const first = focusables[0];
        const last = focusables.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}>
        <header><div><span>项目文件 / {branches.find((branch) => branch.key === getWorkbenchFileStage(selected.filename))?.label}</span><h2>{selected.filename}</h2></div><button ref={closeButton} type="button" aria-label="关闭预览" title="关闭预览" onClick={close}>×</button></header>
        <div className="project-file-preview-body">{loading ? <p role="status">正在打开文件…</p> : error ? <p role="alert">{error} <button type="button" onClick={() => open(selected)}>重试</button></p> : <MarkdownRenderer content={content} />}</div>
        <footer><span>{selected.version ? `当前修订 r${selected.version}` : ""}</span><a href={`/api/projects/${projectId}/files/${selected.id}/download`} aria-label={`下载 ${selected.filename}`}>↓ 下载 Markdown</a></footer>
      </section>
    </div>}
  </>;
}
