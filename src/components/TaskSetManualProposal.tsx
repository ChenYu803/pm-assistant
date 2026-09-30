"use client";

import { useState } from "react";

type DraftIssue = { number: number; suffix: string; content: string; existing: boolean };
const validSuffix = (value: string) => value.length > 0 && value.length <= 180 && value === value.trim() && !/[\\/\u0000-\u001f]/u.test(value);

export default function TaskSetManualProposal({ iterationId, sessionId, onCreated }: {
  iterationId: string; sessionId: string; onCreated: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [issues, setIssues] = useState<DraftIssue[]>([]);
  const [initialCount, setInitialCount] = useState(0);
  const [nextReference, setNextReference] = useState(1);
  const [loading, setLoading] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const url = `/api/iterations/${iterationId}/sessions/${sessionId}/task-candidates`;

  async function openEditor() {
    setOpen(true); setLoading(true); setDraftLoaded(false); setError(""); setNotice("");
    try {
      const response = await fetch(url);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "加载当前任务集合失败");
      const entries: DraftIssue[] = body.files.map((file: Omit<DraftIssue, "existing">) => ({ ...file, existing: true }));
      setIssues(entries); setInitialCount(entries.length);
      setNextReference(Math.max(0, ...entries.map((file) => file.number)) + 1);
      setDraftLoaded(true);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "加载当前任务集合失败"); }
    finally { setLoading(false); }
  }

  function update(number: number, patch: Partial<DraftIssue>) {
    setIssues((current) => current.map((file) => file.number === number ? { ...file, ...patch } : file));
    setError("");
  }

  async function submit() {
    if (working || issues.some((file) => !validSuffix(file.suffix) || !file.content.trim())) return;
    setWorking(true); setError("");
    const content = issues.length ? issues.map((file) =>
      `%%%FILE_BEGIN%%% issues/${String(file.number).padStart(2, "0")}-${file.suffix}.md\n${file.content}\n%%%FILE_END%%%`,
    ).join("\n\n") : "%%%TASK_SET_EMPTY%%%";
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "创建任务候选失败");
      setOpen(false);
      try { await onCreated(); }
      catch { setNotice("候选已创建，但会话未刷新。请刷新页面后审阅并确认。"); }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "创建任务候选失败"); }
    finally { setWorking(false); }
  }

  return <div className="task-manual-proposal">
    {!open ? <button type="button" onClick={() => void openEditor()}>手动提出整套任务</button> : <div className="task-manual-editor">
      <h3>手动提出整套任务</h3>
      <p>已带入本迭代当前集合。修改或移除后，先生成候选审阅差异；此处不会直接改变项目文件。</p>
      {loading ? <p role="status">正在加载当前集合…</p> : draftLoaded ? <>
        <div className="task-manual-files">{issues.map((file) => <div className="task-manual-file" key={file.number}>
          <div className="task-manual-file-heading"><strong>{file.existing ? `issue ${String(file.number).padStart(2, "0")}` : `新增 · 草稿引用 #${String(file.number).padStart(2, "0")}`}</strong><button type="button" disabled={working} onClick={() => setIssues((current) => current.filter((item) => item.number !== file.number))}>从候选移除</button></div>
          <label htmlFor={`task-suffix-${file.number}`}>文件名描述</label>
          <input id={`task-suffix-${file.number}`} value={file.suffix} disabled={working} onChange={(event) => update(file.number, { suffix: event.target.value })} placeholder="例如：订单查询" />
          <label htmlFor={`task-body-${file.number}`}>完整 Markdown 正文</label>
          <textarea id={`task-body-${file.number}`} value={file.content} disabled={working} onChange={(event) => update(file.number, { content: event.target.value })} spellCheck={false} />
        </div>)}</div>
        {!issues.length ? <p>{initialCount ? "候选为空：整套确认后会删除当前全部 issue。" : "目前没有任务，请先新增一个 issue。"}</p> : null}
        <button className="task-manual-add" type="button" disabled={working} onClick={() => {
          setIssues((current) => [...current, { number: nextReference, suffix: "", content: `# ${String(nextReference).padStart(2, "0")} — 任务标题\n\n**What to build:** \n\n**Blocked by:** None\n\n## 验收标准\n- [ ] `, existing: false }]);
          setNextReference((value) => value + 1);
        }}>新增 issue</button>
        <p>已有编号保持不变。新增 issue 的正式编号由系统分配，草稿中的依赖引用会同步调整。</p>
      </> : null}
      {error ? <p className="analysis-candidate-error" role="alert">{error}</p> : null}
      <div className="task-manual-actions"><button type="button" disabled={working} onClick={() => setOpen(false)}>取消</button><button type="button" disabled={working || loading || !draftLoaded || !initialCount && !issues.length || issues.some((file) => !validSuffix(file.suffix) || !file.content.trim())} onClick={() => void submit()}>{working ? "正在创建…" : "生成整套待确认候选"}</button></div>
    </div>}
    {notice ? <p className="analysis-candidate-error" role="status">{notice}</p> : null}
  </div>;
}
