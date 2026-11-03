"use client";
import { useId,useMemo,useRef,useState,useSyncExternalStore,type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { ManualRecharge } from "@/lib/manual-recharges";
import { creditUnits } from "@/lib/credit-values";
import styles from "./CreditLedger.module.css";
function subscribe(listener:()=>void) {
 window.addEventListener("storage",listener);window.addEventListener("manual-recharge",listener);
 return ()=>{window.removeEventListener("storage",listener);window.removeEventListener("manual-recharge",listener);};
}
export default function ManualRechargeForm({actorId,accountId,email}:{actorId:string;accountId:string;email:string}) {
 const id=useId(),router=useRouter(),busy=useRef(false),key="manual-recharge:"+actorId+":"+accountId;
 const [paidRmb,setPaidRmb]=useState(""),[receiptReference,setReference]=useState(""),[reason,setReason]=useState("");
 const [saving,setSaving]=useState(false),[message,setMessage]=useState(""),[error,setError]=useState("");
 const saved=useSyncExternalStore(subscribe,()=>{try{return sessionStorage.getItem(key);}catch{return "!unavailable";}},()=>undefined);
 const pending=useMemo(()=>{
  if(!saved)return null;
  try{const value=JSON.parse(saved) as ManualRecharge;
   if(value.accountId!==accountId||![value.requestId,value.paidRmb,value.receiptReference,value.reason].every(item=>typeof item==="string"))return null;
   return value;
  }catch{return null;}
 },[saved,accountId]);
 const ready=saved!==undefined&&!(saved&&!pending);
 function remember(value:ManualRecharge|null){if(value)sessionStorage.setItem(key,JSON.stringify(value));else sessionStorage.removeItem(key);window.dispatchEvent(new Event("manual-recharge"));}
 async function submit(event:FormEvent<HTMLFormElement>) {
  event.preventDefault();if(busy.current||!ready)return;
  busy.current=true;setSaving(true);setError("");setMessage("");
  const operation=pending??{accountId,requestId:crypto.randomUUID(),paidRmb,receiptReference,reason};
  const uncertain="结果尚未确认，请保留原操作，核对流水或重试同一笔充值。";
  try {
   // 先持久保存操作身份，再发请求；未知结果不释放表单供另建一笔充值。
   remember(operation);
   const response=await fetch("/api/admin/recharges",{method:"POST",signal:AbortSignal.timeout(30000),headers:{"Content-Type":"application/json"},body:JSON.stringify(operation)});
   const value=await response.json();
   if(!response.ok){
    // 重试被拒绝只说明本次没有执行，不能证明此前的未知提交没有到账。
    const knownRejection=!pending&&typeof value?.error==="string"&&[400,403,404,409,413].includes(response.status);
    if(knownRejection)remember(null);
    throw Error((typeof value?.error==="string"?value.error:"入账响应异常。")+(value?.existing?" 原流水："+value.existing.id+"；账号："+value.existing.accountId+"；实收 "+value.existing.context?.originalPaidRmb+" 元；购买积分 "+value.existing.amount+"。":"")+(knownRejection?"":" "+uncertain));
   }
   // 先确认凭据确实属于原转账，完整读取成功消息后才能释放原操作身份。
   let confirmed=false;
   try {
    const entry=value?.entry,expected=creditUnits(operation.paidRmb)*BigInt(1000);
    confirmed=typeof value?.replayed==="boolean"&&typeof entry?.id==="string"&&!!entry.id
     &&entry.accountId===operation.accountId&&entry.businessType==="manual_recharge"&&entry.sourceKind==="purchased"
     &&entry.reason===operation.reason.trim()&&entry.context?.entryId===entry.id
     &&entry.context?.receiptReference===operation.receiptReference.trim().toUpperCase()
     &&creditUnits(entry.context?.originalPaidRmb)===creditUnits(operation.paidRmb)&&creditUnits(entry.amount)===expected
     &&creditUnits(entry.after?.purchased?.available)-creditUnits(entry.before?.purchased?.available)===expected;
   }catch{ /* 缺少字段或金额格式错误时，仍保留原操作等待核对。 */ }
   if(!confirmed)throw Error("入账凭据不完整或与原操作不一致。"+uncertain);
   const success=(value.replayed?"已确认原充值，未重复入账":"购买积分已入账")+"。实收 "+value.entry.context.originalPaidRmb+" 元，购买积分 +"+value.entry.amount+"，购买可用余额 "+value.entry.before.purchased.available+" → "+value.entry.after.purchased.available+"；流水 ID："+value.entry.id+"。";
   remember(null);setPaidRmb("");setReference("");setReason("");setMessage(success);
   router.refresh();
  }catch(cause){
   if(cause instanceof DOMException&&["TimeoutError","AbortError"].includes(cause.name))setError("请求超时。"+uncertain);
   else if(cause instanceof TypeError||cause instanceof SyntaxError)setError("网络或响应异常。"+uncertain);
   else setError(cause instanceof Error?cause.message:uncertain);
  }
  finally{busy.current=false;setSaving(false);}
 }
 return <section className={styles.section} aria-labelledby={id+"-title"}>
  <h2 id={id+"-title"}>人工充值入账</h2>
  <p className={styles.account}>入账账号：{email}<br/>完整账号 ID：{accountId}</p>
  <p className={styles.hint}>仅在核验实际收到转账后录入。1 元人民币 = 1000 购买积分；赠送或补偿请使用下方赠送调整，不能登记为实收。</p>
  <form onSubmit={submit} aria-label="人工充值入账">
   <fieldset disabled={!ready||saving||!!pending} className={styles.fields}>
    <div><label htmlFor={id+"-paid"}>实收人民币（元）</label><input id={id+"-paid"} inputMode="decimal" type="text" required maxLength={12} value={pending?.paidRmb??paidRmb} onChange={event=>setPaidRmb(event.target.value)} placeholder="核验到账金额，如 12.34"/></div>
    <div><label htmlFor={id+"-reference"}>交易参考号</label><input id={id+"-reference"} type="text" required maxLength={128} value={pending?.receiptReference??receiptReference} onChange={event=>setReference(event.target.value)} placeholder="同一转账始终使用同一参考号"/></div>
    <div className={styles.reason}><label htmlFor={id+"-reason"}>实收核验业务说明</label><textarea id={id+"-reason"} required maxLength={500} rows={2} value={pending?.reason??reason} onChange={event=>setReason(event.target.value)}/></div>
   </fieldset>
   <button type="submit" className={styles.submit} disabled={!ready||saving}>{saving?"正在核对入账…":pending?"核对并重试同一笔充值":"确认实收并入账"}</button>
  </form>
  {pending&&<p className={styles.hint}>待确认操作 ID：{pending.requestId}。可能已经到账，请先查看流水或重试同一笔充值；不要更换参考号重新提交。刷新页面仍保留本笔内容。</p>}
  {!ready&&saved!==undefined&&<p role="alert" className={styles.error}>无法读取待确认操作，请保留当前浏览器会话并检查会话存储；先通过充值记录核对，不要新建相同转账。</p>}
  {message&&<p role="status" className={styles.success}>{message}</p>}{error&&<p role="alert" className={styles.error}>{error}</p>}
 </section>;
}
