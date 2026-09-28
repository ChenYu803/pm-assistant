"use client";

import { useCallback, useEffect, useState } from "react";

type Snapshot = { id: string; version: number; sessionId: string; messageId: string; createdAt: string };

export default function PrototypeSnapshotPanel({ projectId, iterationId, revision, focusMessageId }: {
  projectId: string; iterationId: string; revision: number; focusMessageId: string | null;
}) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [readyId, setReadyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [previewRetry, setPreviewRetry] = useState(0);
  const [error, setError] = useState("");
  const [errorScope, setErrorScope] = useState<"list" | "preview" | null>(null);
  const base = `/api/projects/${projectId}/snapshots`;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setErrorScope(null);
    try {
      const response = await fetch(`${base}?iterationId=${iterationId}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "读取 HTML 快照失败。");
      const items = body as Snapshot[];
      setSnapshots(items);
      const focused = items.find((item) => item.messageId === focusMessageId);
      setSelectedId((previous) => focused?.id ?? (items.some((item) => item.id === previous) ? previous : items[0]?.id ?? null));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "读取 HTML 快照失败。");
      setErrorScope("list");
    } finally { setLoading(false); }
  }, [base, iterationId, focusMessageId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load, revision]);

  useEffect(() => {
    if (!selectedId) return;
    let current = true;
    const timer = window.setTimeout(() => {
      setOpening(true);
      setReadyId(null);
      setError("");
      setErrorScope(null);
      fetch(`${base}/${selectedId}?mode=view`).then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error || "打开 HTML 快照失败。");
        }
        if (!response.headers.get("content-type")?.startsWith("text/html")) throw new Error("预览内容格式不正确，请重试。");
        await response.body?.cancel();
        if (current) setReadyId(selectedId);
      }).catch((caught) => {
        if (current) { setError(caught instanceof Error ? caught.message : "打开 HTML 快照失败。"); setErrorScope("preview"); }
      }).finally(() => { if (current) setOpening(false); });
    }, 0);
    return () => { current = false; window.clearTimeout(timer); };
  }, [base, selectedId, revision, previewRetry]);

  const selected = snapshots.find((item) => item.id === selectedId);
  return <div className="prototype-snapshot-panel">
    <p className="context-guidance">HTML 快照是独立的项目资产，不会加入项目文件树或 Agent 上下文。</p>
    {loading ? <p className="snapshot-status" role="status">正在读取快照…</p> : null}
    {!loading && !snapshots.length && !error ? <p className="snapshot-status">还没有 HTML 快照。与原型设计 Agent 讨论页面方案后，可在这里预览和下载。</p> : null}
    {error ? <div className="snapshot-error" role="alert"><span>{error}</span><button type="button" onClick={() => { if (errorScope === "preview") setPreviewRetry((value) => value + 1); else void load(); }}>重试</button></div> : null}
    {snapshots.length ? <div className="snapshot-list" aria-label="HTML 快照列表">{snapshots.map((item) => <button key={item.id} type="button" aria-current={selectedId === item.id ? "true" : undefined} onClick={() => setSelectedId(item.id)}>
      <strong>HTML 快照 · 第 {item.version} 版</strong><small>{new Date(item.createdAt).toLocaleString("zh-CN")}</small>
    </button>)}</div> : null}
    {selected ? <section className="snapshot-detail" aria-label={`HTML 快照第 ${selected.version} 版`}>
      <div className="snapshot-detail-heading"><div><strong>第 {selected.version} 版预览</strong><small>生成于 {new Date(selected.createdAt).toLocaleString("zh-CN")}</small></div><div className="snapshot-detail-actions"><a href={`${base}/${selected.id}?mode=view`} target="_blank" rel="noopener noreferrer">新窗口打开</a><a href={`${base}/${selected.id}?mode=download`} download={`prototype-${selected.version}.html`}>下载 HTML</a></div></div>
      {opening ? <p className="snapshot-status" role="status">正在打开预览…</p> : null}
      {readyId === selected.id ? <iframe key={`${selected.id}-${previewRetry}`} title={`HTML 快照第 ${selected.version} 版预览`} sandbox="allow-scripts" src={`${base}/${selected.id}?mode=view`} onError={() => { setReadyId(null); setError("预览加载失败，请重试。"); setErrorScope("preview"); }} /> : null}
    </section> : null}
  </div>;
}
