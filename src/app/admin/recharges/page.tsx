import Link from "next/link";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { listManualRecharges,rechargeFilters } from "@/lib/manual-recharges";
import styles from "@/components/AdminUsers.module.css";
const dates=new Intl.DateTimeFormat("zh-CN",{timeZone:"Asia/Shanghai",dateStyle:"medium",timeStyle:"short"});
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
 const actor=await requireAdmin();
 if(actor instanceof NextResponse){if(actor.status===401)redirect("/login?callbackUrl=%2Fadmin%2Frecharges");return <div className={styles.shell}><h1>无权访问管理后台</h1><Link href="/profile">返回个人主页</Link></div>;}
 const raw=await searchParams,params=new URLSearchParams();for(const key of ["q","page"])if(typeof raw[key]==="string")params.set(key,raw[key]);
 let filters:{q:string;page:number};try{filters=rechargeFilters(params);}catch{filters={q:"",page:1};}
 const result=await listManualRecharges(filters.q,filters.page),pages=Math.max(1,Math.ceil(result.total/result.pageSize));
 const url=(page:number)=>"/admin/recharges?"+new URLSearchParams({q:filters.q,page:String(page)});
 return <div className={styles.shell}><main className={styles.content}>
  <nav className={styles.nav} aria-label="后台导航"><Link href="/admin">用户管理 / 选择账号入账</Link><Link href="/profile">个人主页</Link></nav>
  <h1>人工充值记录</h1><p className={styles.intro}>核验实收后，请从用户管理选择明确账号入账。这里仅展示实收购买，不包含赠送与补偿；每笔充值保留原始实付及购买来源。</p>
  <form method="get" action="/admin/recharges" className={styles.filters}><div className={styles.field}><label htmlFor="recharge-query">完整账号 ID、邮箱或交易参考号</label><input id="recharge-query" name="q" type="search" maxLength={320} defaultValue={filters.q}/></div><button type="submit">查询充值</button><Link href="/admin/recharges">重置</Link></form>
  <div className={styles.tableRegion} role="region" aria-label="充值记录，可横向滚动" tabIndex={0}><table className={styles.table}>
   <caption>充值共 {result.total} 笔；每页 {result.pageSize} 笔</caption><thead><tr><th scope="col">时间 / 账号</th><th scope="col">实收 / 购买积分</th><th scope="col">凭据与审计</th></tr></thead><tbody>
   {result.entries.map(item=><tr key={item.id}><td><time dateTime={item.createdAt}>{dates.format(new Date(item.createdAt))}</time><p><Link href={"/admin/users/"+item.accountId+"/credits"}>{item.accountEmail}</Link></p><p className={styles.accountId}>{item.accountId}</p></td><td>实收 {String(item.context?.originalPaidRmb)} 元<p>购买积分 +{item.amount}</p><p>购买可用 {item.before.purchased.available} → {item.after.purchased.available}</p><p>赠送可用 {item.before.gift.available} → {item.after.gift.available}</p></td><td><p>交易参考号：{String(item.context?.receiptReference)}</p><p>{item.reason}</p><details><summary>查看充值凭据</summary><p>流水 ID：{item.id}</p><p>操作 ID：{item.requestId}</p><p>操作者：{item.actorEmail}（{item.actorId}）</p>{item.allocations.map(source=><p key={source.sourceId}>购买来源 {source.sourceId}：{source.amount}</p>)}</details></td></tr>)}
   {!result.entries.length&&<tr><td colSpan={3}>暂无符合条件的充值记录。</td></tr>}
   </tbody></table></div>
  <nav className={styles.pagination} aria-label="充值分页">{result.page>1&&<Link href={url(result.page-1)}>上一页</Link>}<span>第 {result.page} / {pages} 页</span>{result.page<pages&&<Link href={url(result.page+1)}>下一页</Link>}</nav>
 </main></div>;
}
