"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./GiftInviteRedemption.module.css";

export default function GiftInviteRedemption({ initiallyRedeemed }: { initiallyRedeemed: boolean }) {
  const router = useRouter();
  const [redeemed, setRedeemed] = useState(initiallyRedeemed);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  async function redeem(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    const requestId = sessionStorage.getItem("giftInviteRequestId") || crypto.randomUUID();
    sessionStorage.setItem("giftInviteRequestId", requestId);
    try {
      const response = await fetch("/api/gift-invites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, requestId }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "兑换失败，请核对邀请码后重试。");
      sessionStorage.removeItem("giftInviteRequestId"); setRedeemed(true); setCode(""); setError(false);
      setMessage(`兑换成功，${result.credits} 积分已到账。`);
      router.refresh();
    } catch (cause) {
      setError(true); setMessage(cause instanceof Error ? cause.message : "兑换结果暂不可确认，请使用相同邀请码重试。");
    } finally { setBusy(false); }
  }

  return <section className={styles.section} aria-labelledby="gift-invite-title">
    <div className={styles.heading}><span>04</span><h2 id="gift-invite-title">赠送邀请码</h2></div>
    <div className={styles.body}>
      {redeemed ? <p className={styles.success}>已成功领取赠送积分，邀请码兑换入口已关闭。</p> : <form onSubmit={redeem}>
        <label htmlFor="profile-gift-invite">邀请码</label>
        <div className={styles.formRow}><input id="profile-gift-invite" value={code} onChange={event => setCode(event.target.value)} maxLength={64} autoComplete="off" required /><button type="submit" disabled={busy}>{busy ? "兑换中…" : "兑换积分"}</button></div>
        <p className={styles.hint}>每个账号限领一次，成功后获得 2000 积分。</p>
      </form>}
      {message && <p className={error ? styles.error : styles.success} role="status">{message}</p>}
    </div>
  </section>;
}
