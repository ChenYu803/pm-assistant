"use client";
import { useId,useRef,useState,type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { isMysqlId } from "@/lib/identifiers";
import { creditText,creditUnits } from "@/lib/credit-values";
import { refundMoney,refundReason,type ManualRefundInput,type ManualRefund,type RefundSource } from "@/lib/manual-refund-values";
import { useRefundDraft } from "./useRefundDraft";
import styles from "./CreditLedger.module.css";
export default function ManualRefundForm({actorId,accountId,sources}:{actorId:string;accountId:string;sources:RefundSource[]}) {
  const id=useId(),router=useRouter(),busy=useRef(false);
  const [selected,setSelected]=useState(""),[amount,setAmount]=useState(""),[reason,setReason]=useState("");
  const [saving,setSaving]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState(""),[lastRefundId,setLastRefundId]=useState("");
  const {pending,remember,ready}=useRefundDraft<ManualRefundInput>("manual-refund:"+actorId+":"+accountId,(value):value is ManualRefundInput=>{
    if(!value||typeof value!=="object")return false;const v=value as ManualRefundInput;
    return v.accountId===accountId&&[v.requestId,v.rechargeEntryId,v.refundRmb,v.reason].every(item=>typeof item==="string");
  });
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();if(busy.current||!ready)return;
    busy.current=true;setSaving(true);setError("");setMessage("");
    try {
      const operation=pending??{accountId,rechargeEntryId:selected,requestId:crypto.randomUUID(),refundRmb:creditText(creditUnits(refundMoney(amount))),reason:refundReason(reason)};
      if(!operation.rechargeEntryId)throw Error("请选择原充值来源。");
      remember(operation);
      const response=await fetch("/api/admin/refunds",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(operation),signal:AbortSignal.timeout(30000)});
      const result=await response.json();
      if(!response.ok) {
        if(!pending&&response.status>=400&&response.status<500)remember(null);
        throw Error(result.error??"退款发起结果待核实，请查询原记录或重试同一操作。");
      }
      const refund=result.refund as ManualRefund;
      const expectedSource=sources.find(source=>source.rechargeEntryId===operation.rechargeEntryId);
      const validState=refund?.accountingStatus==="held"?["unverified","succeeded"].includes(refund.transferStatus):refund?.accountingStatus==="completed"?refund.transferStatus==="succeeded":refund?.accountingStatus==="released"&&refund.transferStatus==="failed";
      if(typeof refund?.id!=="string"||!isMysqlId(refund.id)||typeof refund.sourceId!=="string"||!isMysqlId(refund.sourceId)||(expectedSource&&refund.sourceId!==expectedSource.sourceId)||!validState||refund.accountId!==operation.accountId||refund.rechargeEntryId!==operation.rechargeEntryId||creditUnits(refund.refundRmb)!==creditUnits(operation.refundRmb)||creditUnits(refund.credits)!==creditUnits(operation.refundRmb)*BigInt(1000)||refund.reason!==operation.reason)throw Error("响应缺少一致的退款凭据；保留原操作，先核对退款记录，勿重复转账。");
      remember(null);setLastRefundId(refund.id);setAmount("");setReason("");setMessage("退款记录 "+refund.id+" 已确认。请前往退款与恢复页核实外部处理结果；系统不会代为转账。");router.refresh();
    } catch(cause) {setError(cause instanceof Error?cause.message:"结果待核实，请查询退款记录或重试同一操作；不要另建退款。");}
    finally {busy.current=false;setSaving(false);}
  }
  return <section className={styles.section} aria-label="发起人工退款">
    <h2>发起人工退款</h2><p className={styles.hint}>先选择原实付购买来源。发起只锁定对应可退积分，尚未表示钱已退。外部处理前先核查原记录和收款方；响应丢失或结果不明时不要再次转账。</p>
    {(pending?.rechargeEntryId??selected)&&sources.filter(source=>source.rechargeEntryId===(pending?.rechargeEntryId??selected)).map(source=><p key={source.sourceId} className={styles.hint}>原始购买 {source.originalCredits} 积分；当前可用 {source.available}、模型预留 {source.reserved}、退款锁定 {source.refundHeld} 积分。剩余未退款实付 {source.remainingPaidRmb} 元；当前可退 {source.refundableRmb} 元。金额以提交时重新核实的来源额度为准。</p>)}
    <form onSubmit={submit}>
      <fieldset className={styles.fields} disabled={!ready||saving||!!pending}>
        <div className={styles.reason}><label htmlFor={id+"-source"}>原充值来源</label><select id={id+"-source"} required value={pending?.rechargeEntryId??selected} onChange={event=>setSelected(event.target.value)}><option value="">请选择原充值</option>{sources.map(source=><option key={source.sourceId} value={source.rechargeEntryId}>{source.receiptReference} · 原实付 {source.originalPaidRmb} 元 · 当前可退 {source.refundableRmb} 元</option>)}</select></div>
        <div><label htmlFor={id+"-amount"}>退款人民币（元）</label><input id={id+"-amount"} inputMode="decimal" required maxLength={12} value={pending?.refundRmb??amount} onChange={event=>setAmount(event.target.value)} /></div>
        <div className={styles.reason}><label htmlFor={id+"-reason"}>业务说明</label><textarea id={id+"-reason"} required maxLength={500} rows={2} value={pending?.reason??reason} onChange={event=>setReason(event.target.value)} /></div>
      </fieldset>
      <button type="submit" className={styles.submit} disabled={!ready||saving}>{saving?"正在核对…":pending?"核对并重试原退款发起":"锁定积分并创建退款记录"}</button>
    </form>
    {!sources.length&&<p className={styles.hint}>暂无实付购买来源。赠送积分不能折现退款。</p>}
    {pending&&<p className={styles.hint}>待确认操作 ID：{pending.requestId}。保留原金额和来源，先查询记录；重试不会新增同一笔退款。</p>}
    {!ready&&<p role="status" className={styles.hint}>正在读取待确认操作；若持续无法读取，请检查浏览器会话存储并先查询退款记录。</p>}
    {lastRefundId&&<p><Link href={"/admin/refunds?q="+lastRefundId}>查看本笔退款并登记外部结果</Link></p>}
    {message&&<p role="status" className={styles.success}>{message}</p>}{error&&<p role="alert" className={styles.error}>{error}</p>}
  </section>;
}
