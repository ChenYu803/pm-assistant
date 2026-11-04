import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { findMysqlUserById } from "@/lib/mysql-account-workspace";
import { isMysqlId } from "@/lib/identifiers";
import { readCreditStatement } from "@/lib/credits-ledger";
import { listRefundSources } from "@/lib/manual-refunds";
import ManualRefundForm from "@/components/ManualRefundForm";
import ManualRechargeForm from "@/components/ManualRechargeForm";
import CreditLedger from "@/components/CreditLedger";
import styles from "@/components/AdminUsers.module.css";
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{sourcePage?:string}> }) {
  const actor = await requireAdmin();
  if (actor instanceof NextResponse) {
    if (actor.status === 401) redirect("/login?callbackUrl=%2Fadmin");
    return <div className={styles.shell}><h1>无权访问管理后台</h1><Link href="/profile">返回个人主页</Link></div>;
  }
  const { id } = await params;
  if (!isMysqlId(id)) notFound();
  const user = await findMysqlUserById(id);
  if (!user) notFound();
  const initial = await readCreditStatement(id);
  const rawPage=Number((await searchParams).sourcePage??"1");
  const sources=await listRefundSources(id,Number.isSafeInteger(rawPage)&&rawPage>0&&rawPage<=1000000?rawPage:1);
  return <div className={styles.shell}><div className={styles.content}>
    <nav className={styles.nav} aria-label="后台导航"><Link href="/admin">返回用户管理</Link><Link href="/admin/recharges">充值记录</Link><Link href={"/admin/refunds?q="+id}>退款与恢复</Link><Link href="/profile">个人主页</Link></nav>
    <h1>账号积分</h1><p className={styles.intro}>{user.email} · {user.account_status === "active" ? "正常" : "已停用"}</p>
    <ManualRechargeForm actorId={actor} accountId={id} email={user.email} />
    <ManualRefundForm actorId={actor} accountId={id} sources={sources.sources} />
    <nav className={styles.nav} aria-label="原充值来源分页">{sources.page>1&&<Link href={"?sourcePage="+(sources.page-1)}>上一页来源</Link>}<span>来源第 {sources.page} / {Math.max(1,Math.ceil(sources.total/sources.pageSize))} 页</span>{sources.page*sources.pageSize<sources.total&&<Link href={"?sourcePage="+(sources.page+1)}>下一页来源</Link>}</nav>
    <CreditLedger key={initial.entries[0]?.id ?? "empty"} initial={initial} actorId={actor} />
  </div></div>;
}
