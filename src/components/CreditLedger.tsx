"use client";

import { useId, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { CREDIT_BUSINESS_LABELS, type CreditStatement } from "@/lib/credit-values";
import type { CreditAdjustment } from "@/lib/credits-ledger";
import styles from "./CreditLedger.module.css";

function onAdjustmentChange(listener: () => void) {
  window.addEventListener("storage", listener); window.addEventListener("credit-adjustment", listener);
  return () => { window.removeEventListener("storage", listener); window.removeEventListener("credit-adjustment", listener); };
}
const dates = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "short" });
export default function CreditLedger({ initial, actorId }: { initial: CreditStatement; actorId?: string }) {
  const [data, setData] = useState(initial), [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(""), [error, setError] = useState("");
  const [type, setType] = useState<CreditAdjustment["type"]>("grant"), [amount, setAmount] = useState(""), [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false), readSequence = useRef(0);
  const id = useId(), endpoint = actorId ? "/api/admin/users/" + initial.accountId + "/credits" : "/api/credits";
  const storageKey = "credit-adjustment:" + actorId + ":" + initial.accountId;
  const saved = useSyncExternalStore(onAdjustmentChange, () => {
    if (!actorId) return null;
    try { return sessionStorage.getItem(storageKey); } catch { return "!unavailable"; }
  }, () => undefined);
  const pending = useMemo(() => {
    if (!saved) return null;
    try {
      const value = JSON.parse(saved) as CreditAdjustment;
      if (typeof value.requestId !== "string" || typeof value.amount !== "string" || typeof value.reason !== "string" || !["grant", "compensation", "correction"].includes(value.type)) return null;
      return value;
    } catch { return null; }
  }, [saved]);
  const storageError = !!saved && !pending;
  const ready = !actorId || (saved !== undefined && !storageError);
  function storeOperation(value: CreditAdjustment | null) {
    if (value) sessionStorage.setItem(storageKey, JSON.stringify(value));
    else sessionStorage.removeItem(storageKey);
    window.dispatchEvent(new Event("credit-adjustment"));
  }
  async function refresh(page = data.page) {
    const sequence = ++readSequence.current;
    setLoading(true); setError("");
    try {
      const response = await fetch(endpoint + "?page=" + page, { cache: "no-store" });
      const value = await response.json();
      if (!response.ok) throw Error(value.error || "查询失败，请重试。");
      if (sequence === readSequence.current) setData(value);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "查询失败，请重试。"); }
    finally { if (sequence === readSequence.current) setLoading(false); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (inFlight.current || !ready) return;
    inFlight.current = true;
    setError(""); setMessage(""); setSaving(true);
    const operation = pending ?? { requestId: crypto.randomUUID(), type, amount, reason };
    try {
      // 发送前保存身份；刷新、响应丢失后的重试仍对应同一笔操作。
      storeOperation(operation);
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(operation) });
      const value = await response.json();
      if (!response.ok) {
        if ([400, 404, 409, 413].includes(response.status)) { storeOperation(null); }
        throw Error(value.error || "操作结果尚未确认，请刷新流水核对或重试同一操作。");
      }
      storeOperation(null); setAmount(""); setReason("");
      setMessage((value.replayed ? "已确认原操作" : "积分已记录") + "，流水 ID：" + value.entry.id + "。赠送可用积分 " + value.entry.before.gift.available + " → " + value.entry.after.gift.available + "。");
      await refresh(1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "结果尚未确认，请刷新流水核对或重试同一操作。"); }
    finally { inFlight.current = false; setSaving(false); }
  }
  const maxPage = Math.max(1, Math.ceil(data.total / data.pageSize));
  return <section className={styles.section} aria-labelledby={id + "-title"}>
    <div className={styles.heading}><h2 id={id + "-title"}>积分与流水</h2><button type="button" onClick={() => refresh()} disabled={loading || saving}>{loading ? "查询中…" : "刷新流水"}</button></div>
    <p className={styles.account}>账号 ID：<span>{data.accountId}</span></p>
    <dl className={styles.balances} aria-label="积分余额"><div><dt>赠送积分</dt><dd>可用 <strong>{data.balance.gift.available}</strong><span>预留 {data.balance.gift.reserved}</span></dd></div><div><dt>购买积分</dt><dd>可用 <strong>{data.balance.purchased.available}</strong><span>预留 {data.balance.purchased.reserved}</span></dd></div></dl>
    <p className={styles.hint}>单位：积分。可用积分可供后续调用；预留积分为调用暂时占用的额度，尚未最终消耗。</p>
    {actorId && <form className={styles.form} onSubmit={submit} aria-label="管理员积分调整">
      <h3>赠送与余额纠正</h3><p className={styles.hint}>赠送、补偿与纠正均保存操作记录。纠正填写正数增加、负数扣减，只能调整赠送积分的可用部分。</p>
      <fieldset disabled={!ready || saving || !!pending} className={styles.fields}>
        <div><label htmlFor={id + "-type"}>业务类型</label><select id={id + "-type"} value={pending?.type ?? type} onChange={event => setType(event.target.value as CreditAdjustment["type"])}><option value="grant">管理员赠送</option><option value="compensation">补偿</option><option value="correction">赠送余额纠正</option></select></div>
        <div><label htmlFor={id + "-amount"}>变动积分</label><input id={id + "-amount"} inputMode="decimal" type="text" required maxLength={30} placeholder="如 2000 或 -0.25" value={pending?.amount ?? amount} onChange={event => setAmount(event.target.value)} /></div>
        <div className={styles.reason}><label htmlFor={id + "-reason"}>操作原因</label><textarea id={id + "-reason"} required maxLength={500} rows={2} value={pending?.reason ?? reason} onChange={event => setReason(event.target.value)} placeholder="说明赠送用途或纠正依据" /></div>
      </fieldset>
      <button type="submit" disabled={!ready || saving || loading} className={styles.submit}>{saving ? "正在记录…" : pending ? "重试同一操作" : "记录积分变动"}</button>
      {pending && <p className={styles.hint}>待确认操作 ID：{pending.requestId}。重试只会返回同一笔结果。</p>}
    </form>}
    {message && <p role="status" className={styles.success}>{message}</p>}{(error || storageError) && <p role="alert" className={styles.error}>{error || "无法读取待确认操作，请启用浏览器会话存储后刷新页面。"}</p>}
    {data.pendingCalls?.length ? <div aria-label="未结算模型调用">{data.pendingCalls.map(call => <p key={call.id}>调用 {call.id} · {call.state === "pending" ? "待核对" : "生成中"} · 冻结 {call.reserved} 积分</p>)}</div> : null}
    <div className={styles.scroll} role="region" aria-label="积分流水，可横向滚动" tabIndex={0} aria-busy={loading}>
      <table className={styles.table}><caption>积分流水 · 共 {data.total} 笔，每页 {data.pageSize} 笔</caption><thead><tr><th scope="col">时间与业务</th><th scope="col">变动与余额</th><th scope="col">原因与追溯</th></tr></thead><tbody>
        {data.entries.map(item => <tr key={item.id}><td><time dateTime={item.createdAt}>{dates.format(new Date(item.createdAt))}</time><span>{CREDIT_BUSINESS_LABELS[item.businessType] ?? item.businessType}</span><span>{item.sourceKind === "gift" ? "赠送积分" : "购买积分"}</span></td><td><strong>{item.amount === "0" || item.amount.startsWith("-") ? "" : "+"}{item.amount}</strong><span>赠送可用 {item.before.gift.available} → {item.after.gift.available}</span><span>购买可用 {item.before.purchased.available} → {item.after.purchased.available}</span><span>预留：赠送 {item.after.gift.reserved} / 购买 {item.after.purchased.reserved}</span></td><td><p>{item.reason}</p>{item.businessType === "manual_recharge" && <p>实收人民币：{String(item.context?.originalPaidRmb)} 元<br/>交易参考号：{String(item.context?.receiptReference)}</p>}<details><summary>查看流水凭据</summary><p>流水 ID：{item.id}</p><p>操作者：{item.actorEmail}（{item.actorId}）</p><p>操作 ID：{item.requestId}</p>{item.allocations.map(source => <p key={source.sourceId}>来源 {source.sourceId}：{source.amount}</p>)}{item.context && <p>关联信息：{JSON.stringify(item.context)}</p>}</details></td></tr>)}
        {!data.entries.length && <tr><td colSpan={3}>暂无积分流水。注册本身不赠送积分；到账与调整后可在这里核对。</td></tr>}
      </tbody></table>
    </div>
    <nav className={styles.pagination} aria-label="积分流水分页"><button type="button" disabled={loading || saving || data.page <= 1} onClick={() => refresh(data.page - 1)}>上一页</button><span>第 {data.page} / {maxPage} 页</span><button type="button" disabled={loading || saving || data.page >= maxPage} onClick={() => refresh(data.page + 1)}>下一页</button></nav>
  </section>;
}
