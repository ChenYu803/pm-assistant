import Link from "next/link";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { listAdminUsers } from "@/lib/admin-users";
import DisableAccountControl from "@/components/DisableAccountControl";
import styles from "@/components/AdminUsers.module.css";

const dateFormat = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "short" });
function date(value: unknown) { return value ? dateFormat.format(new Date(value as string)) : "—"; }

export default async function AdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireAdmin();
  if (actor instanceof NextResponse) {
    if (actor.status === 401) redirect("/login?callbackUrl=%2Fadmin");
    return <div className={styles.shell}><h1>无权访问管理后台</h1><p>仅指定管理员可以使用此功能。</p><Link href="/projects">返回项目</Link></div>;
  }
  const params = await searchParams;
  const search = typeof params.q === "string" ? params.q.trim().slice(0, 320) : "";
  const status = typeof params.status === "string" && ["active", "disabled"].includes(params.status) ? params.status : "all";
  const requestedPage = Number(params.page ?? "1");
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 && requestedPage <= 1000000 ? requestedPage : 1;
  const result = await listAdminUsers(search, status, page);
  function pageUrl(next: number) { return "/admin?" + new URLSearchParams({ q: search, status, page: String(next) }); }
  return <div className={styles.shell}><div className={styles.content}>
    <nav className={styles.nav} aria-label="后台导航"><span>运营后台 · 用户管理</span><Link href="/admin/recharges">人工充值记录</Link><Link href="/admin/model-requests">模型请求与成本</Link><Link href="/admin/gift-invites">管理赠送邀请码</Link><Link href="/profile">返回个人主页</Link></nav>
    <h1>用户管理</h1>
    <p className={styles.intro}>查询账号状态，停用异常账号。停用操作会保存操作者、时间和业务说明。</p>
    <dl className={styles.summary} aria-label="用户数量汇总"><div><dt>全部用户</dt><dd>{result.summary.total}</dd></div><div><dt>正常</dt><dd>{result.summary.active}</dd></div><div><dt>已停用</dt><dd>{result.summary.disabled}</dd></div></dl>
    <form method="get" action="/admin" className={styles.filters}>
      <div className={styles.field}><label htmlFor="account-search">账号邮箱或完整 ID</label><input id="account-search" name="q" type="search" maxLength={320} defaultValue={search} placeholder="输入邮箱或账号 ID" /></div>
      <div className={styles.field}><label htmlFor="account-status">账号状态</label><select id="account-status" name="status" defaultValue={status}><option value="all">全部状态</option><option value="active">正常</option><option value="disabled">已停用</option></select></div>
      <button type="submit">查询</button><Link href="/admin">重置</Link>
    </form>
    <div className={styles.tableRegion} role="region" aria-label="用户列表，可横向滚动" tabIndex={0}>
      <table className={styles.table}><caption>符合条件的用户共 {result.total} 位；每页 {result.pageSize} 位</caption><thead><tr><th scope="col">账号</th><th scope="col">状态</th><th scope="col">注册时间</th><th scope="col">管理操作与记录</th></tr></thead>
        <tbody>{result.users.map(user => <tr key={user.id}>
          <td>{user.email}{user.nickname && <span className={styles.id}>{user.nickname}</span>}<span className={styles.id}>{user.id}</span><span className={styles.id}>赠送可用 {user.giftAvailable} · 购买可用 {user.purchasedAvailable} 积分</span></td>
          <td className={user.status === "disabled" ? styles.disabled : undefined}>{user.status === "disabled" ? "已停用" : "正常"}</td>
          <td className={styles.date}>{date(user.createdAt)}</td>
          <td><p><Link href={"/admin/users/" + user.id + "/credits"}>查看积分 / 赠送与调整</Link></p>{user.status === "disabled" ? <div className={styles.audit}><p>{user.disabledReason}</p><p className={styles.muted}>停用时间：{date(user.disabledAt)}</p><p className={styles.id}>操作者：{user.disabledBy}</p></div> : user.id === actor ? <span className={styles.muted}>当前管理员</span> : <DisableAccountControl userId={user.id} email={user.email} />}</td>
        </tr>)}{result.total === 0 && <tr><td colSpan={4}>没有符合条件的用户，请调整查询条件。</td></tr>}</tbody>
      </table>
    </div>
    <nav className={styles.pagination} aria-label="用户分页">{result.page > 1 ? <Link href={pageUrl(result.page - 1)}>上一页</Link> : <span className={styles.muted}>上一页</span>}<span>第 {result.page} / {Math.max(1, Math.ceil(result.total / result.pageSize))} 页</span>{result.page * result.pageSize < result.total ? <Link href={pageUrl(result.page + 1)}>下一页</Link> : <span className={styles.muted}>下一页</span>}</nav>
  </div></div>;
}
