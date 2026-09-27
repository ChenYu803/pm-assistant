"use client";

import { useState } from "react";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import type { ProjectFileEntry } from "@/components/ProjectFileTree";
import { validAnalysisFilename } from "@/lib/analysis-candidate-filename";

export type AnalysisCandidate = {
  id: string;
  suggestedFilename: string;
  content: string;
  status: "pending" | "discarded" | "written";
  finalFilename: string | null;
};

export default function AnalysisCandidateReview({ candidate, iterationId, sessionId, files, onDecided }: {
  candidate: AnalysisCandidate;
  iterationId: string;
  sessionId: string;
  files: ProjectFileEntry[];
  onDecided: () => Promise<void>;
}) {
  const [filename, setFilename] = useState(candidate.suggestedFilename);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [settled, setSettled] = useState<"discarded" | "written" | null>(null);
  const status = settled ?? candidate.status;
  const operation = files.some((file) => file.filename === filename) ? "overwrite" : "create";
  const pending = status === "pending";

  async function decide(action: "write" | "discard") {
    if (working || !pending || (action === "write" && !validAnalysisFilename(filename))) return;
    setWorking(true);
    setError("");
    try {
      const response = await fetch(`/api/iterations/${iterationId}/sessions/${sessionId}/candidates/${candidate.id}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(action === "write" ? { filename, expectedOperation: operation } : {}) }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 409) await onDecided().catch(() => undefined);
        throw new Error(body.error || "候选操作失败，请重试");
      }
      try { await onDecided(); }
      catch { setError("操作已完成，但文件列表未刷新。请刷新页面核对结果。"); }
      setSettled(action === "write" ? "written" : "discarded");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "候选操作失败，请重试");
    } finally { setWorking(false); }
  }

  return <section className="analysis-candidate" aria-label="需求分析文件候选">
    <div className="analysis-candidate-heading"><strong>需求分析文件候选</strong><span data-status={status}>{pending ? "待确认" : status === "written" ? "已写入" : "已放弃"}</span></div>
    {pending ? <>
      <label className="analysis-candidate-label" htmlFor={`candidate-name-${candidate.id}`}>文件名</label>
      <input id={`candidate-name-${candidate.id}`} value={filename} onChange={(event) => { setFilename(event.target.value); setError(""); }} disabled={working} spellCheck={false} />
      {!validAnalysisFilename(filename) ? <p className="analysis-candidate-error" role="alert">文件名应为“需求分析-描述.md”，不能包含路径。</p> : null}
      <div className="analysis-candidate-target"><span>{operation === "create" ? "创建新文件" : "覆盖已有文件"}</span><strong>{filename || "尚未填写文件名"}</strong><small>需求分析 / {filename || "…"}</small></div>
      <p className="analysis-candidate-explain">确认后将完整正文写入项目文件树。预览和放弃都不会修改项目文件。</p>
    </> : <p className="analysis-candidate-outcome">{status === "written" ? `已保存到需求分析 / ${settled ? filename : candidate.finalFilename}` : "这份候选已放弃，项目文件未改变。"}</p>}
    {error ? <p className="analysis-candidate-error" role="alert">{error}{pending ? " 候选仍保留，可重试。" : ""}</p> : null}
    {pending ? <div className="analysis-candidate-actions"><button type="button" disabled={working} onClick={() => void decide("discard")}>放弃候选</button><button type="button" disabled={working || !validAnalysisFilename(filename)} onClick={() => void decide("write")}>{working ? "正在处理…" : operation === "create" ? "确认创建" : "确认覆盖"}</button></div> : null}
    <button className="analysis-candidate-preview-toggle" type="button" aria-expanded={previewOpen} onClick={() => setPreviewOpen((value) => !value)}>{previewOpen ? "收起 Markdown 预览" : "预览完整 Markdown"}</button>
    {previewOpen ? <div className="analysis-candidate-preview"><MarkdownRenderer content={candidate.content} /></div> : null}
  </section>;
}
