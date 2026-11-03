import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { findMysqlUserById } from "@/lib/mysql-account-workspace";
import { isMysqlId } from "@/lib/identifiers";
import { readCreditStatement } from "@/lib/credits-ledger";
import ManualRechargeForm from "@/components/ManualRechargeForm";
import CreditLedger from "@/components/CreditLedger";
import styles from "@/components/AdminUsers.module.css";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
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
  return <div className={styles.shell}><div className={styles.content}>
    <nav className={styles.nav} aria-label="后台导航"><Link href="/admin">返回用户管理</Link><Link href="/admin/recharges">充值记录</Link><Link href="/profile">个人主页</Link></nav>
    <h1>账号积分</h1><p className={styles.intro}>{user.email} · {user.account_status === "active" ? "正常" : "已停用"}</p>
    <ManualRechargeForm actorId={actor} accountId={id} email={user.email} />
    <CreditLedger key={initial.entries[0]?.id ?? "empty"} initial={initial} actorId={actor} />
  </div></div>;
}
