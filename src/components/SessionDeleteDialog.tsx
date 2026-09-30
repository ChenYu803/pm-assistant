"use client";

import { useState } from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";

export default function SessionDeleteDialog({ iterationId, session, generating, onClose, onDeleted, onViewGeneration }: {
  iterationId: string;
  session: { id: string; title: string };
  generating: boolean;
  onClose: () => void;
  onDeleted: () => void;
  onViewGeneration: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [blockedByGeneration, setBlockedByGeneration] = useState(false);
  async function confirmDelete() {
    if (deleting || generating) return;
    setDeleting(true); setError(""); setBlockedByGeneration(false);
    try {
      const response = await fetch(`/api/iterations/${iterationId}/sessions/${session.id}`, { method: "DELETE" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setBlockedByGeneration(body.reason === "generating");
        throw new Error(body.error || "删除未完成，请重试。");
      }
      onDeleted();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "删除未完成，请重试。"); }
    finally { setDeleting(false); }
  }
  return <AlertDialog.Root open onOpenChange={(open) => { if (!open && !deleting) onClose(); }}>
    <AlertDialog.Portal>
      <AlertDialog.Overlay className="session-delete-overlay" />
      <AlertDialog.Content className="iteration-risk-dialog session-delete-dialog" aria-busy={deleting}
        onEscapeKeyDown={(event) => { if (deleting) event.preventDefault(); }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const target = document.querySelector<HTMLButtonElement>(`.session-row[data-session-id="${session.id}"]`) ?? document.querySelector<HTMLButtonElement>(".session-row[aria-current='page'], .new-session-button");
          target?.focus();
        }}>
        <AlertDialog.Title asChild><h2>删除阶段会话？</h2></AlertDialog.Title>
        <AlertDialog.Description asChild><p>即将删除「{session.title}」。此操作无法撤销。</p></AlertDialog.Description>
        <div className="iteration-risk-items">
          <div><strong>会丢失</strong><p>本会话的全部消息、过程状态、未发送草稿、上下文引用，以及未确认的文件和任务集合候选。</p></div>
          <div><strong>会保留</strong><p>已确认写入的项目文件、现有上一版备份和项目级变更记录；已保存的 HTML 快照也会保留。来源继续使用写入时的名称快照。</p></div>
        </div>
        {generating ? <p className="iteration-form-error" role="status">会话正在生成。请等待完成，或先停止生成，再删除。</p> : null}
        {error ? <p className="iteration-form-error" role="alert">{error}</p> : null}
        {(generating || blockedByGeneration) ? <button className="session-delete-next" type="button" disabled={deleting} onClick={onViewGeneration}>查看会话并停止生成</button> : null}
        <div className="iteration-risk-actions">
          <AlertDialog.Cancel className="iteration-button iteration-button-quiet" disabled={deleting}>取消</AlertDialog.Cancel>
          <button className="iteration-button iteration-button-danger" type="button" disabled={deleting || generating} onClick={() => void confirmDelete()}>{deleting ? "删除中…" : "确认删除会话"}</button>
        </div>
      </AlertDialog.Content>
    </AlertDialog.Portal>
  </AlertDialog.Root>;
}
