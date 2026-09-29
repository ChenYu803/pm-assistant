"use client";

import { useEffect, useState } from "react";

type Write = { fileId: string; filename: string; deleted: boolean; changes: { operation: string; occurredAt: string }[] };
const operationName: Record<string, string> = {
  create: "创建", overwrite: "覆盖", edit: "编辑", restore: "撤回", rename: "改名", delete: "删除",
};

export default function IterationWriteSummary({ iterationId, revision }: { iterationId: string; revision: number }) {
  const [writes, setWrites] = useState<Write[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/iterations/${iterationId}/writes`, { signal: controller.signal })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error || "本轮写入加载失败"); setWrites(body); setError(""); })
      .catch((caught) => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "本轮写入加载失败"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [iterationId, revision, retry]);

  return <div className="context-scroll iteration-write-summary" aria-label="本轮写入">
    <p className="context-guidance">本轮确认写入或由你修改的项目文件。文件属于整个项目，其他迭代也能查看。</p>
    {loading ? <p role="status">正在加载本轮写入…</p> : error ? <p role="alert">{error} <button type="button" onClick={() => { setLoading(true); setRetry((value) => value + 1); }}>重试</button></p> :
      writes.length ? <ul>{writes.map((write) => <li key={write.fileId}><strong>{write.filename}</strong><span>{write.deleted ? "已删除 · " : ""}{write.changes.length} 次变更 · 最近{operationName[write.changes[0].operation] ?? write.changes[0].operation}</span></li>)}</ul>
        : <p className="context-empty">这一轮还没有确认写入或修改项目文件。Agent 的未确认候选不会计入这里。</p>}
  </div>;
}
