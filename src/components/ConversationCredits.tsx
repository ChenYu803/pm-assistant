"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { creditText, creditUnits, type CreditCallView, type CreditStatement } from "@/lib/credit-values";

export function ReplyCredits({ call }: { call?: CreditCallView }) {
  if (!call) return null;
  return <p className="reply-credits" data-credit-state={call.state}>本次预留 {call.reserved} 积分 · {call.state === "settled" ? (call.reason === "stopped_confirmed" ? "已停止，按实结算 " : "实际消耗 ") + call.consumed + " 积分" : call.state === "pending" ? (call.reason === "stopped_usage_unconfirmed" ? "已停止，待核对，预留暂未释放" : "待核对，预留暂未释放") : call.state === "released" ? "已免单，预留已释放" : "生成中，完成后按实际用量结算"}</p>;
}
export function AccountCredits() {
  const [statement,setStatement] = useState<CreditStatement | null>(null);
  const [stale,setStale] = useState(false);
  useEffect(() => {
    let active = true, busy = false;
    const controller = new AbortController();
    const refresh = async () => {
      if (busy || document.visibilityState === "hidden") return;
      busy = true;
      try {
        const response = await fetch("/api/credits",{cache:"no-store",signal:controller.signal});
        if (!response.ok) throw Error("积分查询失败");
        const value: CreditStatement = await response.json();
        if (active) { setStatement(value); setStale(false); }
      } catch { if (active) setStale(true); } finally { busy = false; }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(),3000);
    window.addEventListener("focus",refresh); window.addEventListener("credit-balance-change",refresh); document.addEventListener("visibilitychange",refresh);
    return () => { active = false; controller.abort(); window.clearInterval(timer); window.removeEventListener("focus",refresh); window.removeEventListener("credit-balance-change",refresh); document.removeEventListener("visibilitychange",refresh); };
  },[]);
  const available = statement ? creditText(creditUnits(statement.balance.gift.available)+creditUnits(statement.balance.purchased.available)) : "…";
  const reserved = statement ? creditText(creditUnits(statement.balance.gift.reserved)+creditUnits(statement.balance.purchased.reserved)) : "…";
  return <Link href="/profile" className="account-credits" aria-label="账号积分，查看个人中心"><span>可用 <strong>{available}</strong> 积分</span><span>账号冻结 {reserved} 积分</span>{stale ? <small>余额更新失败，稍后自动重试</small> : null}</Link>;
}
