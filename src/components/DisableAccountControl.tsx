"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import styles from "./AdminUsers.module.css";

export default function DisableAccountControl({ userId, email }: { userId: string; email: string }) {
  const router = useRouter(), inputId = useId();
  const [open, setOpen] = useState(false), [reason, setReason] = useState(""), [error, setError] = useState("");
  const [saving, setSaving] = useState(false), [refreshing, startTransition] = useTransition();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const response = await fetch("/api/admin/users/" + userId + "/disable", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "停用失败，请重试。");
      setOpen(false); setReason(""); startTransition(() => router.refresh());
    } catch (error) { setError(error instanceof Error ? error.message : "停用失败，请重试。"); }
    finally { setSaving(false); }
  }
  if (!open) return <button type="button" className={styles.textButton} disabled={refreshing} onClick={() => setOpen(true)} aria-label={"停用 " + email}>{refreshing ? "更新中…" : "停用账号"}</button>;
  return <form onSubmit={submit} className={styles.disableForm}>
    <p>停用后，该账号将无法登录或发起新的 AI 请求。</p>
    <label htmlFor={inputId}>停用说明</label>
    <textarea id={inputId} required maxLength={500} rows={3} value={reason} onChange={event => setReason(event.target.value)} disabled={saving} />
    <div className={styles.actions}>
      <button type="submit" disabled={saving || !reason.trim()}>{saving ? "停用中…" : "确认停用"}</button>
      <button type="button" disabled={saving} onClick={() => { setOpen(false); setError(""); }}>取消</button>
    </div>
    {error && <p role="alert">{error}</p>}
  </form>;
}
