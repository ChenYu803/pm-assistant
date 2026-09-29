"use client";

import { useEffect, useState } from "react";
import type { ProjectFileEntry } from "@/components/ProjectFileTree";
import { getWorkbenchFileStage } from "@/lib/workbench-file-branch";

type Change = {
  id: string; operation: string; filename: string; previousFilename: string | null;
  actor: "agent" | "user"; iterationId: string | null; iterationNumber: number;
  iterationName: string; iterationDeleted: boolean; stage: string | null;
  sessionName: string | null; occurredAt: string;
};
type History = {
  filename: string; deleted: boolean; canUndo: boolean;
  createdBy: Change | null; lastContentChange: Change | null; changes: Change[];
};

const operationName: Record<string, string> = {
  create: "创建文件", overwrite: "覆盖正文", edit: "用户编辑", restore: "撤回正文",
  rename: "重命名", delete: "删除文件",
};
const stageName: Record<string, string> = {
  analysis: "需求分析", prototype: "原型", prd: "PRD", tickets: "任务拆分",
};

function source(change: Change | null, projectId: string) {
  if (!change) return <span>早期文件，来源未记录</span>;
  const label = `迭代 ${String(change.iterationNumber).padStart(2, "0")}${change.iterationDeleted ? "（已删除）" : ""} · ${change.iterationName}`;
  return <span className="file-source">
    {change.iterationId ? <a href={`/projects/${projectId}/iterations/${change.iterationId}`}>{label}</a> : label}
    <span>{change.actor === "user" ? "用户操作" : `Agent 写入${change.stage ? ` · ${stageName[change.stage] ?? change.stage}` : ""}${change.sessionName ? ` · ${change.sessionName}` : ""}`}</span>
  </span>;
}

function time(value: string) {
  return new Date(value).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function ProjectFileDetails({ projectId, iterationId, file, onChanged, onIdentityChanged }: {
  projectId: string; iterationId?: string; file: ProjectFileEntry;
  onChanged?: () => void; onIdentityChanged: (change: { filename: string; deleted: boolean }) => void;
}) {
  const [history, setHistory] = useState<History | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"read" | "rename" | "delete">("read");
  const [filename, setFilename] = useState(file.filename);
  const [working, setWorking] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/projects/${projectId}/files/${file.id}/history`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "文件详情加载失败");
        setHistory(body);
        setFilename(body.filename);
      })
      .catch((caught) => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "文件详情加载失败"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [projectId, file.id, refresh]);

  async function changeIdentity(action: "rename" | "delete") {
    if (!iterationId || working) return;
    setWorking(true);
    setError("");
    try {
      const response = await fetch(`/api/iterations/${iterationId}/files/${file.id}`, {
        method: action === "rename" ? "PATCH" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, ...(action === "rename" ? { action, filename } : {}) }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "文件操作失败，请重试");
      setMode("read");
      onIdentityChanged({ filename: body.filename, deleted: body.deleted });
      onChanged?.();
      setLoading(true);
      setRefresh((value) => value + 1);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "文件操作失败，请重试"); }
    finally { setWorking(false); }
  }

  if (loading) return <p role="status">正在加载文件详情…</p>;
  if (!history) return <p role="alert">{error} <button type="button" onClick={() => { setError(""); setLoading(true); setRefresh((value) => value + 1); }}>重试</button></p>;
  const canModify = iterationId && !history.deleted && getWorkbenchFileStage(history.filename) !== "tickets";
  return <div className="project-file-details">
    <div className="file-detail-state"><strong>{history.deleted ? "已删除" : "当前内容"}</strong><span>{history.deleted ? "正文和上一版备份已永久删除，仅保留路径与来源记录。" : history.canUndo ? "可撤回到上次正文修改前" : "没有可撤回的上一版"}</span></div>
    <dl className="file-detail-facts">
      <div><dt>当前路径</dt><dd>{history.filename}</dd></div>
      <div><dt>创建来源</dt><dd>{source(history.createdBy, projectId)}</dd></div>
      <div><dt>最近正文来源</dt><dd>{source(history.lastContentChange, projectId)}{history.lastContentChange && <time dateTime={history.lastContentChange.occurredAt}>{time(history.lastContentChange.occurredAt)}</time>}</dd></div>
      <div><dt>撤回目标</dt><dd>{history.deleted ? "文件已删除，无法撤回" : history.canUndo ? "上次正文修改前的内容；撤回后不能重做" : "暂无可撤回内容"}</dd></div>
    </dl>
    {canModify && <div className="file-detail-actions"><button type="button" onClick={() => { setMode("rename"); setFilename(history.filename); setError(""); }}>改名</button><button type="button" className="danger" onClick={() => { setMode("delete"); setError(""); }}>删除文件</button></div>}
    {mode === "rename" && <form className="file-detail-confirm" onSubmit={(event) => { event.preventDefault(); void changeIdentity("rename"); }}><label>新文件名<input value={filename} onChange={(event) => setFilename(event.target.value)} disabled={working} maxLength={190} /></label><p>保留当前树枝前缀和 .md 后缀。改名不会修改正文或增加正文修订。</p><div><button type="button" disabled={working} onClick={() => setMode("read")}>取消</button><button type="submit" disabled={working || filename === history.filename}>{working ? "改名中…" : "确认改名"}</button></div></form>}
    {mode === "delete" && <div className="file-detail-confirm danger" role="alertdialog" aria-label="确认删除文件"><strong>永久删除「{history.filename}」？</strong><p>当前正文、唯一上一版备份和会话中的文件引用都会删除，无法恢复。文件树会保留已删除占位与来源时间线。</p><div><button type="button" disabled={working} onClick={() => setMode("read")}>取消</button><button type="button" disabled={working} onClick={() => void changeIdentity("delete")}>{working ? "删除中…" : "确认永久删除"}</button></div></div>}
    {error && <p className="project-file-revision-error" role="alert">{error}</p>}
    <section className="file-detail-timeline" aria-label="变更时间线"><h3>变更时间线</h3>{history.changes.length ? <ol>{[...history.changes].reverse().map((change) => <li key={change.id}><div><strong>{operationName[change.operation] ?? change.operation}</strong><time dateTime={change.occurredAt}>{time(change.occurredAt)}</time></div><p>{change.operation === "rename" ? `${change.previousFilename} → ${change.filename}` : change.filename}</p><small>{source(change, projectId)}</small></li>)}</ol> : <p>此文件创建于来源记录启用前，暂无变更记录。</p>}</section>
  </div>;
}
