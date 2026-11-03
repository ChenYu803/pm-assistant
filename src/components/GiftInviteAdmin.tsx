"use client";

import { useEffect, useState } from "react";
import styles from "./GiftInviteAdmin.module.css";

type Code = { id: string; status: "available" | "redeemed" | "void"; credits: string; createdAt: string; redeemedAt: string | null; redeemedEmail: string | null; redeemedUserId: string | null };
type Data = { batches: { id: string; codeCount: number; createdAt: string }[]; codes: Code[]; actions: { id: string; action: string; reason: string; createdAt: string; actorEmail: string }[] };
const dateFormat = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "short" });

export default function GiftInviteAdmin() {
  const [data, setData] = useState<Data | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function refresh() {
    const response = await fetch("/api/admin/gift-invites", { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "邀请码状态查询失败。");
    setData(result);
  }
  useEffect(() => {
    let active = true;
    fetch("/api/admin/gift-invites", { cache: "no-store" })
      .then(async response => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "邀请码状态查询失败。");
        if (active) setData(result);
      })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "邀请码状态查询失败。"); });
    return () => { active = false; };
  }, []);

  async function seed(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/admin/gift-invites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "首批邀请码初始化失败。");
      setCodes(result.codes); setReason(""); setNotice("首批 100 个邀请码已创建。完整码仅本次显示，请立即复制并妥善保管。"); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "初始化状态未知，请刷新查询后确认。"); }
    finally { setBusy(false); }
  }
  async function voidCode(id: string) {
    if (!reason.trim()) { setError("作废前请填写原因。"); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/admin/gift-invites/${id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "邀请码作废失败。");
      setReason(""); setNotice("邀请码已作废；已到账的赠送积分不会追回。"); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "作废失败，请刷新确认状态。"); }
    finally { setBusy(false); }
  }

  return <div className={styles.content}>
    {!data && !error && <p>正在读取邀请码…</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {notice && <p className={styles.notice} role="status">{notice}</p>}
    {data && !data.batches.length && <form className={styles.seed} onSubmit={seed}>
      <h2>初始化首批邀请码</h2><p>一次创建 100 个独立邀请码，每码赠送 2000 积分。初始化不可重复。</p>
      <label htmlFor="gift-seed-reason">操作原因</label><div className={styles.actions}><input id="gift-seed-reason" required maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /><button disabled={busy}>{busy ? "正在初始化…" : "创建首批邀请码"}</button></div>
    </form>}
    {codes.length > 0 && <section className={styles.created}>
      <div className={styles.tableHead}><h2>本次生成的 100 个邀请码</h2><button type="button" onClick={() => navigator.clipboard.writeText(codes.join("\n")).then(() => setNotice("100 个邀请码已复制。"), () => setError("复制失败，请手动选择完整码。"))}>复制全部</button></div>
      <textarea aria-label="本次生成的邀请码" readOnly value={codes.join("\n")} rows={8} />
    </section>}
    {data && data.batches.length > 0 && <>
      <div className={styles.summary}><strong>首批已初始化</strong><span>{data.codes.length} 个码</span><span>每码 2000 积分</span><span>初始化于 {dateFormat.format(new Date(data.batches[0].createdAt))}</span></div>
      <label className={styles.reasonLabel} htmlFor="gift-void-reason">作废原因</label><input className={styles.reasonInput} id="gift-void-reason" maxLength={500} value={reason} onChange={event => setReason(event.target.value)} />
      <div className={styles.tableRegion} role="region" aria-label="邀请码及领取记录" tabIndex={0}>
        <table><thead><tr><th>状态</th><th>领取账号与时间</th><th>邀请码 ID</th><th>操作</th></tr></thead><tbody>{data.codes.map(code => <tr key={code.id}>
          <td>{code.status === "available" ? "未领取" : code.status === "redeemed" ? "已领取" : "已作废"}</td>
          <td>{code.redeemedEmail || "—"}{code.redeemedUserId && <small>{code.redeemedUserId}</small>}{code.redeemedAt && <small>{dateFormat.format(new Date(code.redeemedAt))}</small>}</td>
          <td><code>{code.id}</code></td><td>{code.status === "available" ? <button type="button" disabled={busy} onClick={() => voidCode(code.id)}>作废</button> : "—"}</td>
        </tr>)}</tbody></table>
      </div>
      <section className={styles.audit}><h2>最近管理操作</h2><ul>{data.actions.map(action => <li key={action.id}>{action.action === "seed" ? "初始化" : "作废"} · {action.actorEmail} · {dateFormat.format(new Date(action.createdAt))} · {action.reason}</li>)}</ul></section>
    </>}
  </div>;
}
