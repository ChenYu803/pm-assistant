"use client";

import { useCallback, useEffect, useState } from "react";
import MarkdownRenderer from "@/components/MarkdownRenderer";

export type TaskSetCandidate = { id: string; status: "pending" | "discarded" | "written" };
type Entry = { number: number; filename: string; content: string; change: string; previousFilename: string | null };
type Preview = { status: TaskSetCandidate["status"]; fingerprint: string; entries: Entry[]; deleted: Entry[] };

const changeLabel: Record<string, string> = {
  create: "新增", content: "更新正文", rename: "改名", "content-and-rename": "更新正文并改名",
  delete: "删除", unchanged: "保留",
};

export default function TaskSetCandidateReview({ candidate, iterationId, sessionId, onDecided }: {
  candidate: TaskSetCandidate; iterationId: string; sessionId: string; onDecided: () => Promise<void>;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [settled, setSettled] = useState<TaskSetCandidate["status"] | null>(null);
  const [openFile, setOpenFile] = useState<string | null>(null);
  const url = `/api/iterations/${iterationId}/sessions/${sessionId}/task-candidates/${candidate.id}`;
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(url);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "加载任务差异失败");
      setPreview(body);
      setError("");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "加载任务差异失败"); }
    finally { setLoading(false); }
  }, [url]);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(url, { signal: controller.signal }).then(async (response) => {
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "加载任务差异失败");
      setPreview(body);
    }).catch((caught) => {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "加载任务差异失败");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [url]);

  const status = settled ?? preview?.status ?? candidate.status;
  const entries = preview ? [...preview.entries, ...preview.deleted] : [];
  const counts = Object.fromEntries(["create", "content", "rename", "content-and-rename", "delete", "unchanged"]
    .map((kind) => [kind, entries.filter((entry) => entry.change === kind).length]));

  async function decide(action: "write" | "discard") {
    if (working || status !== "pending" || !preview) return;
    setWorking(true); setError("");
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(action === "write" ? { expectedFingerprint: preview.fingerprint } : {}) }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 409) await refresh();
        throw new Error(body.error || "任务候选操作失败");
      }
      setSettled(action === "write" ? "written" : "discarded");
      try { await onDecided(); }
      catch { setError("操作已完成，但文件列表未刷新。请刷新页面核对结果。"); }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "任务候选操作失败"); }
    finally { setWorking(false); }
  }

  return <section className="analysis-candidate task-set-candidate" aria-label="任务集合候选">
    <div className="analysis-candidate-heading"><strong>任务集合候选</strong><span data-status={status}>{status === "pending" ? "待整套确认" : status === "written" ? "已提交" : "已放弃"}</span></div>
    {loading ? <p role="status">正在核对当前任务集合…</p> : null}
    {preview ? <>
      <p className="analysis-candidate-explain">确认后，此处列出的 issue 将成为本迭代任务文件夹的完整内容。删除项会移出文件夹；只能整套确认。</p>
      <div className="task-set-summary" aria-label="任务差异汇总">
        <span>新增 <strong>{counts.create}</strong></span><span>更新 <strong>{counts.content + counts.rename + counts["content-and-rename"]}</strong></span><span>删除 <strong>{counts.delete}</strong></span><span>保留 <strong>{counts.unchanged}</strong></span>
      </div>
      <div className="task-set-list">{entries.map((entry) => <div className="task-set-row" key={`${entry.change}-${entry.number}`}>
        <div className="task-set-row-head"><span data-change={entry.change}>{changeLabel[entry.change]}</span><strong>{entry.filename}</strong></div>
        {entry.previousFilename && entry.previousFilename !== entry.filename ? <small>原路径：{entry.previousFilename}</small> : null}
        {entry.change === "delete" ? <p>确认后从当前集合移除；撤回整套提交时可恢复。</p> : <button type="button" className="analysis-candidate-preview-toggle" aria-expanded={openFile === entry.filename} onClick={() => setOpenFile((value) => value === entry.filename ? null : entry.filename)}>{openFile === entry.filename ? "收起正文" : "预览正文"}</button>}
        {openFile === entry.filename && entry.change !== "delete" ? <div className="analysis-candidate-preview"><MarkdownRenderer content={entry.content} /></div> : null}
      </div>)}</div>
      {status === "pending" ? <div className="analysis-candidate-actions"><button type="button" disabled={working} onClick={() => void decide("discard")}>放弃整套候选</button><button type="button" disabled={working} onClick={() => void decide("write")}>{working ? "正在处理…" : "确认整套提交"}</button></div> : <p className="analysis-candidate-outcome">{status === "written" ? "整套任务已提交到本迭代文件夹。" : "候选已放弃，任务文件夹未改变。"}</p>}
    </> : null}
    {error ? <p className="analysis-candidate-error" role="alert">{error}{status === "pending" ? " 候选仍保留，可重试。" : ""}</p> : null}
    {!loading && !preview ? <button type="button" onClick={() => void refresh()}>重新加载差异</button> : null}
  </section>;
}
