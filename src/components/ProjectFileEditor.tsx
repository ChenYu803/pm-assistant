"use client";
import { useFilePolish } from "@/components/useFilePolish";
import { FilePolishResult } from "@/components/FilePolishResult";

export default function ProjectFileEditor({projectId,fileId,initialContent,saving,onSave,onCancel}: {
  projectId: string; fileId: string; initialContent: string; saving: boolean;
  onSave: (content: string) => Promise<boolean>; onCancel: () => void;
}) {
  const polish = useFilePolish(true,{projectId,fileId},initialContent);
  return <div className="project-file-edit">
    <label htmlFor="project-file-content">Markdown 正文</label>
    <textarea id="project-file-content" value={polish.content} disabled={saving || polish.busy || polish.pending} onChange={event => polish.edit(event.target.value)} />
    <FilePolishResult polish={polish} />
    <div className="project-file-edit-actions">
      <button type="button" disabled={saving || polish.busy || !polish.ready || !polish.content.trim()} onClick={() => void polish.polish()}>{polish.busy ? "润色中…" : polish.pending ? "重试原请求" : "AI 润色"}</button>
      <button type="button" disabled={saving} onClick={onCancel}>取消</button>
      <button type="button" disabled={saving || polish.busy || polish.content === initialContent} onClick={async () => { if (await onSave(polish.content)) polish.saved(); }}>{saving ? "保存中…" : "保存修改"}</button>
    </div>
  </div>;
}
