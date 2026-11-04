import Link from "next/link";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { listManualRefunds,refundFilters } from "@/lib/manual-refunds";
import { TRANSFER_LABELS,REFUND_ACCOUNTING_LABELS } from "@/lib/manual-refund-values";
import ManualRefundAction from "@/components/ManualRefundAction";
import styles from "@/components/AdminUsers.module.css";
import ledgerStyles from "@/components/CreditLedger.module.css";
const dates=new Intl.DateTimeFormat("zh-CN",{timeZone:"Asia/Shanghai",dateStyle:"medium",timeStyle:"short"});
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const actor=await requireAdmin();
  if(actor instanceof NextResponse){if(actor.status===401)redirect("/login?callbackUrl=%2Fadmin%2Frefunds");return <div className={styles.shell}><h1>无权访问管理后台</h1><Link href="/profile">返回个人主页</Link></div>;}
  const raw=await searchParams,params=new URLSearchParams();for(const key of ["q","page"])if(typeof raw[key]==="string")params.set(key,raw[key]);
  let filters:{q:string;page:number};try{filters=refundFilters(params);}catch{filters={q:"",page:1};}
  const result=await listManualRefunds({q:filters.q},filters.page),pages=Math.max(1,Math.ceil(result.total/result.pageSize));
  const url=(page:number)=>"/admin/refunds?"+new URLSearchParams({q:filters.q,page:String(page)});
  return <div className={styles.shell}><main className={styles.content}>
    <nav className={styles.nav} aria-label="后台导航"><Link href="/admin">用户管理 / 选择账号退款</Link><Link href="/admin/recharges">充值记录</Link><Link href="/profile">个人主页</Link></nav>
    <h1>人工退款与恢复</h1><p className={styles.intro}>先从账号积分页选择原充值并锁定积分。这里登记已经核实的外部转账结果；系统不代为转账。结果不明时继续锁定，钱已退但记账未完成时仅重试内部记账。</p>
    <form method="get" action="/admin/refunds" className={styles.filters}><div className={styles.field}><label htmlFor="refund-query">完整账号 ID、邮箱、原充值 ID、退款 ID 或外部参考号</label><input id="refund-query" name="q" type="search" maxLength={320} defaultValue={filters.q}/></div><button type="submit">查询退款</button><Link href="/admin/refunds">重置</Link></form>
    <section className={ledgerStyles.section} aria-label="后台退款记录">
      <div className={ledgerStyles.scroll} role="region" aria-label="后台退款记录，可横向滚动" tabIndex={0}><table className={ledgerStyles.table}><caption>共 {result.total} 笔退款，每页 {result.pageSize} 笔</caption><thead><tr><th scope="col">账号与原充值</th><th scope="col">金额与处理状态</th><th scope="col">核查与恢复</th></tr></thead><tbody>
        {result.refunds.map(refund=><tr key={refund.id}><td><Link href={"/admin/users/"+refund.accountId+"/credits"}>{refund.accountEmail}</Link><p>账号 ID：{refund.accountId}</p><p>原充值：{refund.rechargeEntryId}</p><p>来源：{refund.sourceId}</p></td><td><time dateTime={refund.createdAt}>{dates.format(new Date(refund.createdAt))}</time><p>退款 {refund.refundRmb} 元 / {refund.credits} 购买积分</p><p>{TRANSFER_LABELS[refund.transferStatus]}</p><p>{REFUND_ACCOUNTING_LABELS[refund.accountingStatus]}</p><p>外部参考号：{refund.externalReference??"待核实"}</p></td><td><p>退款 ID：{refund.id}</p><p>{refund.reason}</p><p>发起人：{refund.actorEmail}</p><p>核实说明：{refund.transferReason??"待核实"}</p><p>更新于 {dates.format(new Date(refund.updatedAt))}</p><ManualRefundAction key={refund.id+":"+refund.transferStatus+":"+refund.accountingStatus} actorId={actor} refund={refund}/></td></tr>)}
        {!result.refunds.length&&<tr><td colSpan={3}>暂无匹配退款。</td></tr>}
      </tbody></table></div>
      <nav className={ledgerStyles.pagination} aria-label="后台退款分页">{result.page>1?<Link href={url(result.page-1)}>上一页</Link>:<span>上一页</span>}<span>第 {result.page} / {pages} 页</span>{result.page<pages?<Link href={url(result.page+1)}>下一页</Link>:<span>下一页</span>}</nav>
    </section>
  </main></div>;
}
