"use client";

import { useState } from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";

export default function IterationDeleteDialog({ projectId, iteration, onClose, onDeleted }: {
  projectId: string;
  iteration: { id: string; iteration_number: number; display_name: string };
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [blockedByGeneration, setBlockedByGeneration] = useState(false);

  async function confirmDelete() {
    if (deleting) return;
    setDeleting(true); setError(""); setBlockedByGeneration(false);
    try {
      const response = await fetch(`/api/iterations/${iteration.id}`, { method: "DELETE" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setBlockedByGeneration(body.reason === "generating");
        throw new Error(body.error || "删除未完成，请重试。");
      }
      // 仅在服务端提交成功后清理本轮选择；失败与阻止保持原状态。
      try {
        for (const stage of ["analysis", "prototype", "prd", "tickets"]) {
          window.sessionStorage.removeItem(`stage-session:${iteration.id}:${stage}`);
        }
      } catch { /* 浏览器禁用会话存储时不影响成功删除。 */ }
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
          const target = document.querySelector<HTMLButtonElement>(`[data-iteration-id="${iteration.id}"] .iteration-more`)
            ?? document.querySelector<HTMLButtonElement>(".iteration-create-button");
          target?.focus();
        }}>
        <AlertDialog.Title asChild><h2>删除产品迭代？</h2></AlertDialog.Title>
        <AlertDialog.Description asChild><p>即将删除迭代 {String(iteration.iteration_number).padStart(2, "0")}「{iteration.display_name}」。此操作无法撤销，稳定编号不会复用。</p></AlertDialog.Description>
        <div className="iteration-risk-items">
          <div><strong>会丢失</strong><p>本迭代的全部阶段会话、消息、工作状态、未发送草稿、上下文引用，以及未确认的文件和任务集合候选。</p></div>
          <div><strong>会保留</strong><p>项目文件、现有上一版备份、任务旧集合、HTML 快照和项目级变更记录。来源显示为已删除迭代；任务文件夹保留为只读归档，其他迭代不能接管。</p></div>
        </div>
        <p>没有当前迭代时，仍可从项目文件树浏览、预览和下载成果。</p>
        {error ? <p className="iteration-form-error" role="alert">{error}</p> : null}
        {blockedByGeneration ? <a className="session-delete-next" href={`/projects/${projectId}/iterations/${iteration.id}`}>前往工作区停止生成</a> : null}
        <div className="iteration-risk-actions">
          <AlertDialog.Cancel className="iteration-button iteration-button-quiet" disabled={deleting}>取消</AlertDialog.Cancel>
          <button className="iteration-button iteration-button-danger" type="button" disabled={deleting} onClick={() => void confirmDelete()}>{deleting ? "删除中…" : "确认删除迭代"}</button>
        </div>
      </AlertDialog.Content>
    </AlertDialog.Portal>
  </AlertDialog.Root>;
}
