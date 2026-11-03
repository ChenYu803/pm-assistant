import Link from "next/link";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { listModelRequests, modelRequestQuery } from "@/lib/model-request-ledger";
import styles from "@/components/AdminUsers.module.css";

const labels: Record<string,string> = { running: "生成中", processing: "正文处理中", completed: "已完成", stopped: "主动停止", failed: "故障", interrupted: "中断", reliable: "用量可靠", pending: "用量待确认", chat: "旧会话", stage_chat: "阶段会话", polish: "文件润色" };
const formatter = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "short", timeStyle: "medium" });
function date(value: unknown) { return value ? formatter.format(new Date(value as string)) : "—"; }
export default async function ModelRequestsPage({ searchParams }: { searchParams: Promise<Record<string,string|string[]|undefined>> }) {
 const actor = await requireAdmin();
 if (actor instanceof NextResponse) {
  if (actor.status === 401) redirect("/login?callbackUrl=%2Fadmin%2Fmodel-requests");
  return <div className={styles.shell}><h1>无权访问管理后台</h1><Link href="/projects">返回项目</Link></div>;
 }
 const raw = await searchParams, params = new URLSearchParams();
 for (const key of ["q","status","usage","page"]) if (typeof raw[key] === "string") params.set(key,raw[key]);
 let query: ReturnType<typeof modelRequestQuery>; try { query = modelRequestQuery(params); } catch { return <div className={styles.shell}><h1>查询条件不正确</h1><Link href="/admin/model-requests">重置查询</Link></div>; }
 let result; try { result = await listModelRequests(query); } catch { return <div className={styles.shell}><h1>成本查询暂时不可用</h1><p>请稍后刷新重试。</p><Link href="/admin">返回后台</Link></div>; }
 function pageUrl(page: number) { return "/admin/model-requests?"+new URLSearchParams({ ...query,page: String(page) }); }
 return <div className={styles.shell}><div className={styles.content}>
  <nav className={styles.nav} aria-label="后台导航"><Link href="/admin">用户管理</Link><span>模型请求与成本</span><Link href="/profile">返回个人主页</Link></nav>
  <h1>模型请求与成本</h1><p className={styles.intro}>查看官方 Flash 的请求、可靠用量与人民币成本。故障免单产生的供应商费用仍计入网站承担成本；待确认成本不会按零元计算。</p>
  <dl className={styles.summary} aria-label="累计模型成本"><div><dt>已确认成本</dt><dd>¥{result.summary.confirmedCostCny}</dd></div><div><dt>成本待确认</dt><dd>{result.summary.pending} 笔</dd></div><div><dt>网站承担已知成本</dt><dd>¥{result.summary.websiteCostCny}</dd></div><div><dt>网站承担待确认</dt><dd>{result.summary.websitePending} 笔</dd></div><div><dt>累计模型预算</dt><dd>¥200</dd></div></dl>
  <p className={styles.muted}>{result.summary.budgetPeriod}；汇总覆盖全部已记录请求，筛选只影响下方列表。邮件、服务器与域名费用单列。</p><p className={styles.muted}>{result.summary.historicalCoverage}</p>
  <form action="/admin/model-requests" method="get" className={styles.filters}>
   <div className={styles.field}><label htmlFor="request-search">调用、账号或供应商请求 ID</label><input id="request-search" name="q" maxLength={160} defaultValue={query.q} placeholder="输入完整 ID" /></div>
   <div className={styles.field}><label htmlFor="request-status">请求状态</label><select id="request-status" name="status" defaultValue={query.status}><option value="all">全部状态</option>{["running","processing","completed","stopped","failed","interrupted"].map(key=><option value={key} key={key}>{labels[key]}</option>)}</select></div>
   <div className={styles.field}><label htmlFor="request-usage">用量状态</label><select id="request-usage" name="usage" defaultValue={query.usage}><option value="all">全部用量</option><option value="reliable">用量可靠</option><option value="pending">用量待确认</option></select></div>
   <button type="submit">查询</button><Link href="/admin/model-requests">重置</Link>
  </form>
  <div className={styles.tableRegion} role="region" aria-label="模型请求列表，可横向滚动" tabIndex={0}><table className={styles.table}>
   <caption>符合条件的请求共 {result.total} 笔；每页 {result.pageSize} 笔</caption><thead><tr><th scope="col">调用与账号</th><th scope="col">时间与结果</th><th scope="col">用量与成本</th><th scope="col">追溯依据</th></tr></thead>
   <tbody>{result.requests.map(row=><tr key={row.id}>
    <td><span>{labels[row.purpose] ?? row.purpose}</span><span className={styles.id}>调用：{row.id}</span><span className={styles.id}>账号：{row.userId}</span></td>
    <td>{labels[row.status] ?? row.status}<p className={styles.muted}>开始：{date(row.startedAt)}<br/>结束：{date(row.endedAt)}</p>{row.errorCode && <span className={styles.id}>故障类型：{row.errorCode}</span>}</td>
    <td><p>{labels[row.usageStatus]}</p>{row.usage && <p>输入 {row.usage.prompt_tokens}（缓存命中 {row.usage.prompt_cache_hit_tokens} / 未命中 {row.usage.prompt_cache_miss_tokens}）<br/>输出 {row.usage.completion_tokens}（含推理）</p>}<p>{row.costCny === null ? "成本待确认" : "¥"+row.costCny}</p><span className={styles.muted}>{row.websiteBorne ? "网站承担；用户免单" : row.status === "processing" ? "正文处理中" : row.costCny === null ? "等待可靠用量与价格" : "供应商成本已记录"}</span></td>
    <td><details><summary>查看计量依据</summary><span className={styles.id}>请求模型：{row.requestedModel}<br/>返回模型：{row.actualModel ?? "待确认"}<br/>供应商调用：{row.providerId ?? "未取得"}<br/>上游请求：{row.upstreamRequestId ?? "未取得"}<br/>结束原因：{row.finishReason ?? "未取得"}<br/>成本依据：{row.costReason}</span>{row.price?.start && <p>价格快照：{row.price.start.version}<br/>{row.price.start.peak ? "高峰" : "空闲"}，人民币 / 百万 tokens<br/>缓存命中 {row.price.start.inputHitPerMillion}；未命中 {row.price.start.inputMissPerMillion}；输出 {row.price.start.outputPerMillion}</p>}{row.price?.fixture && <p>隔离供应商替身证据</p>}</details></td>
   </tr>)}{result.total === 0 && <tr><td colSpan={4}>没有符合条件的请求。</td></tr>}</tbody>
  </table></div>
  <nav className={styles.pagination} aria-label="模型请求分页">{result.page>1 ? <Link href={pageUrl(result.page-1)}>上一页</Link> : <span className={styles.muted}>上一页</span>}<span>第 {result.page} / {Math.max(1,Math.ceil(result.total/result.pageSize))} 页</span>{result.page*result.pageSize<result.total ? <Link href={pageUrl(result.page+1)}>下一页</Link> : <span className={styles.muted}>下一页</span>}</nav>
 </div></div>;
}
