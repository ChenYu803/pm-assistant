"use client";
import { useId,useRef,useState,type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { parseRefundAction,type ManualRefund,type RefundAction } from "@/lib/manual-refund-values";
import { useRefundDraft } from "./useRefundDraft";
import styles from "./CreditLedger.module.css";
export default function ManualRefundAction({actorId,refund}:{actorId:string;refund:ManualRefund}) {
  const id=useId(),router=useRouter(),busy=useRef(false);
  const [action,setAction]=useState<RefundAction["action"]>(refund.transferStatus==="succeeded"?"complete":"confirm-transfer");
  const [reason,setReason]=useState(""),[reference,setReference]=useState(""),[verified,setVerified]=useState(false);
  const [saving,setSaving]=useState(false),[message,setMessage]=useState(""),[error,setError]=useState("");
  const {pending,remember,ready}=useRefundDraft<RefundAction>("manual-refund-action:"+actorId+":"+refund.id,(value):value is RefundAction=>{try{parseRefundAction(value);return true;}catch{return false;}});
  // 只在已查询到确定外部事实后解除冲突草稿；未知结果仍保留原登记。
  const pendingConflict=!!pending&&refund.transferStatus!=="unverified"&&(pending.action==="complete"?refund.transferStatus!=="succeeded":
    refund.transferStatus!==(pending.action==="confirm-transfer"?"succeeded":"failed")||refund.externalReference!==(pending.externalReference??null)||refund.transferReason!==pending.reason);
  const currentAction=pending?.action??(refund.transferStatus==="succeeded"?"complete":action);
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();if(busy.current||!ready||pendingConflict)return;
    busy.current=true;setSaving(true);setError("");setMessage("");
    try {
      const operation=pending??parseRefundAction({action:currentAction,reason,...(currentAction!=="complete"&&reference?{externalReference:reference}:{})});
      remember(operation);
      const response=await fetch("/api/admin/refunds/"+refund.id,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(operation),signal:AbortSignal.timeout(30000)});
      const result=await response.json();
      if(!response.ok){if(!pending&&response.status>=400&&response.status<500)remember(null);if(response.status===409)router.refresh();throw Error(result.error??"处理结果待核实；保留原记录，请勿再次转账。");}
      const value=result.refund as ManualRefund;
      if(value?.id!==refund.id||value.accountId!==refund.accountId||value.rechargeEntryId!==refund.rechargeEntryId||value.sourceId!==refund.sourceId||value.credits!==refund.credits||value.refundRmb!==refund.refundRmb||
        (operation.action==="mark-failed"?(value.transferStatus!=="failed"||value.accountingStatus!=="released"):(value.transferStatus!=="succeeded"||!["held","completed"].includes(value.accountingStatus)))||
        (operation.action==="confirm-transfer"&&value.externalReference!==operation.externalReference)||
        (operation.action==="complete"&&value.accountingStatus!=="completed"))throw Error("响应凭据不完整或不一致，结果待核实。保留本次操作并查询原退款，勿再次转账。");
      remember(null);setMessage(result.warning??(value.accountingStatus==="completed"?"外部退款已确认，内部扣账完成。":value.accountingStatus==="released"?"已核实外部未退款，积分锁定已释放。":"外部退款已确认，积分保持锁定；仅重试内部记账。"));router.refresh();
    } catch(cause) {setError(cause instanceof Error?cause.message:"处理结果待核实，勿再次转账。");}
    finally {busy.current=false;setSaving(false);}
  }
  if(pendingConflict)return <section aria-label={"处理退款 "+refund.id}>
    <p role="alert" className={styles.hint}>已查询到确定的外部结果，原待确认登记与最新记录冲突。保留的登记：{pending?.action==="mark-failed"?"未转账或转账失败":pending?.action==="confirm-transfer"?"外部退款成功":"内部记账"}，说明：{pending?.reason}。请核对当前记录，勿再次转账。</p>
    <p className={styles.hint}>{refund.transferStatus==="succeeded"?(refund.accountingStatus==="held"?"外部退款已确认，积分仍锁定。可解除旧登记并仅重试内部记账。":"外部退款已确认，内部扣账已完成。") : "已核实未退款或转账失败，积分锁定已释放。"}</p>
    <button type="button" disabled={!ready||saving} onClick={()=>{remember(null);setAction("complete");setReason("");setReference("");setVerified(false);setError("");setMessage("");}}>{refund.accountingStatus==="held"?"核对最新状态并转入内部记账":"核对最终状态并关闭旧登记"}</button>
  </section>;
  if(refund.accountingStatus!=="held"&&!pending)return null;
  return <form onSubmit={submit} aria-label={"处理退款 "+refund.id}>
    <p className={styles.hint}>{refund.transferStatus==="succeeded"?"钱已退回，相关积分持续锁定。这里只重试内部记账，禁止再次转账。":"外部结果尚未核实。请先核对实际转账结果，再登记；无法确认时保持锁定，不能按失败释放。"}</p>
    <fieldset className={styles.fields} disabled={!ready||saving||!!pending}>
      <div><label htmlFor={id+"-action"}>处理方式</label><select id={id+"-action"} value={currentAction} onChange={event=>{setAction(event.target.value as RefundAction["action"]);setVerified(false);}}>{currentAction!=="complete"?<><option value="confirm-transfer">已核实外部退款成功</option><option value="mark-failed">已核实未转账或转账失败</option></>:<option value="complete">仅重试内部记账</option>}</select></div>
      {currentAction!=="complete"&&<div><label htmlFor={id+"-reference"}>外部交易参考号{currentAction==="mark-failed"?"（可选）":""}</label><input id={id+"-reference"} required={currentAction==="confirm-transfer"} maxLength={128} value={pending?.externalReference??reference} onChange={event=>setReference(event.target.value)} /></div>}
      <div className={styles.reason}><label htmlFor={id+"-reason"}>核实依据 / 恢复说明</label><textarea id={id+"-reason"} required rows={2} maxLength={500} value={pending?.reason??reason} onChange={event=>setReason(event.target.value)} /></div>
    </fieldset>
    {!pending&&<label className={styles.hint}><input style={{width:"auto",marginRight:8}} type="checkbox" required checked={verified} onChange={event=>setVerified(event.target.checked)} disabled={saving}/>我已核实原退款及实际外部结果；此次登记不会发起转账。</label>}
    <p><button type="submit" disabled={!ready||saving||(!pending&&!verified)}>{saving?"正在核对…":pending?"核对并重试原登记":currentAction==="complete"?"仅重试内部记账":"登记已核实的外部结果"}</button></p>
    {pending&&<p className={styles.hint}>本次结果尚待确认，已保留核实内容。只查询或重试同一登记，勿再次转账。 <button type="button" disabled={saving} onClick={()=>router.refresh()}>查询最新状态</button></p>}
    {message&&<p role="status" className={styles.success}>{message}</p>}{error&&<p role="alert" className={styles.error}>{error}</p>}
  </form>;
}
