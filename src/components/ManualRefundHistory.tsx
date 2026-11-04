"use client";
import { useState } from "react";
import { TRANSFER_LABELS,REFUND_ACCOUNTING_LABELS,type ManualRefund } from "@/lib/manual-refund-values";
import styles from "./CreditLedger.module.css";
const dates=new Intl.DateTimeFormat("zh-CN",{timeZone:"Asia/Shanghai",dateStyle:"medium",timeStyle:"short"});
export default function ManualRefundHistory({initial,total,held}:{initial:ManualRefund[];total:number;held:string}) {
  const [data,setData]=useState({refunds:initial,total,page:1,pageSize:20}),[loading,setLoading]=useState(false),[error,setError]=useState("");
  async function refresh(page:number) {
    if(loading)return;setLoading(true);setError("");
    try {const response=await fetch("/api/refunds?page="+page,{cache:"no-store",signal:AbortSignal.timeout(30000)});const value=await response.json();if(!response.ok)throw Error(value.error??"查询失败");setData(value);}
    catch {setError("暂时无法查询退款结果，请稍后重试；结果未知不表示退款失败。");}finally {setLoading(false);}
  }
  return <section aria-label="人工退款记录">
    <h3>人工退款记录</h3><p className={styles.hint}>退款锁定 {held} 积分，已从可用额度中移出，与模型预留分别记录。仅未消费、未被调用预留的购买积分可退；赠送积分不折现。退款请联系运营者。</p>
    <button type="button" disabled={loading} onClick={()=>window.location.reload()}>刷新退款与余额</button>
    {error&&<p role="alert" className={styles.error}>{error}</p>}
    <div className={styles.scroll} role="region" aria-label="退款记录，可横向滚动" tabIndex={0} aria-busy={loading}>
      <table className={styles.table}><caption>退款记录 · 共 {data.total} 笔</caption><thead><tr><th scope="col">时间与金额</th><th scope="col">处理结果</th><th scope="col">业务凭据</th></tr></thead><tbody>
        {data.refunds.map(refund=><tr key={refund.id}><td><time dateTime={refund.createdAt}>{dates.format(new Date(refund.createdAt))}</time><span>退款 {refund.refundRmb} 元</span><span>对应购买积分 {refund.credits}</span></td><td><p>{TRANSFER_LABELS[refund.transferStatus]}</p><p>{REFUND_ACCOUNTING_LABELS[refund.accountingStatus]}</p>{refund.transferStatus==="unverified"&&<p>结果待核实，相关积分保持锁定。</p>}{refund.transferStatus==="succeeded"&&refund.accountingStatus==="held"&&<p>外部已退款，内部待处理；无需再次转账。</p>}</td><td><p>{refund.reason}</p><details><summary>查看退款凭据</summary><p>退款 ID：{refund.id}</p><p>原充值：{refund.rechargeEntryId}</p><p>购买来源：{refund.sourceId}</p><p>外部参考号：{refund.externalReference??"待核实"}</p><p>核实说明：{refund.transferReason??"待核实"}</p><p>操作者：{refund.actorEmail}</p><p>更新时间：{dates.format(new Date(refund.updatedAt))}</p></details></td></tr>)}
        {!data.refunds.length&&<tr><td colSpan={3}>暂无退款记录。</td></tr>}
      </tbody></table>
    </div>
    <nav className={styles.pagination} aria-label="退款记录分页"><button type="button" disabled={loading||data.page<=1} onClick={()=>refresh(data.page-1)}>上一页退款</button><span>第 {data.page} / {Math.max(1,Math.ceil(data.total/data.pageSize))} 页</span><button type="button" disabled={loading||data.page*data.pageSize>=data.total} onClick={()=>refresh(data.page+1)}>下一页退款</button></nav>
  </section>;
}
