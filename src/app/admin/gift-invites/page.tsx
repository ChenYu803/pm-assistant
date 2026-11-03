import Link from "next/link";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import GiftInviteAdmin from "@/components/GiftInviteAdmin";
import styles from "@/components/AdminUsers.module.css";

export default async function GiftInviteAdminPage() {
  const actor = await requireAdmin();
  if (actor instanceof NextResponse) {
    if (actor.status === 401) redirect("/login?callbackUrl=%2Fadmin%2Fgift-invites");
    return <div className={styles.shell}><h1>无权访问管理后台</h1><Link href="/projects">返回项目</Link></div>;
  }
  return <div className={styles.shell}><div className={styles.content}>
    <nav className={styles.nav} aria-label="后台导航"><Link href="/admin">返回用户管理</Link><Link href="/profile">个人主页</Link></nav>
    <h1>赠送邀请码</h1><p className={styles.intro}>查看领取情况并作废未使用邀请码。作废不会追回已经到账的积分。</p>
    <GiftInviteAdmin />
  </div></div>;
}
