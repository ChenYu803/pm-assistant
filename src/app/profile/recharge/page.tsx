import Link from "next/link";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helper";
import styles from "@/components/AdminUsers.module.css";
export default async function Page() {
 const accountId=await requireAuth();if(accountId instanceof NextResponse)redirect("/login?callbackUrl=%2Fprofile%2Frecharge");
 // 未配置时明确不可用，不发布虚构或模板联系方式。
 const configured=process.env.RECHARGE_WECHAT_CONTACT?.trim();
 const contact=configured&&!/placeholder|example|todo|待填写|请填写|your[_ -]?wechat|示例/i.test(configured)?configured:null;
 return <div className={styles.shell}><main className={styles.content}>
  <nav className={styles.nav} aria-label="账号导航"><Link href="/profile">返回个人中心与积分流水</Link></nav>
  <h1>获取积分 / 联系充值</h1>
  <p className={styles.intro}>产品处于早期试用阶段，充值由运营者人工处理，不是在线支付或自动到账服务。</p>
  <section aria-labelledby="recharge-contact"><h2 id="recharge-contact">先联系，再转账</h2>
   {contact?<p className={styles.intro}>运营者微信：<strong>{contact}</strong></p>:<p className={styles.intro} role="status">充值联系方式暂未开放，请勿自行转账。运营者补齐并核实真实联系方式后再开放充值。</p>}
   <p className={styles.intro}>当前账号 ID：<strong className={styles.accountId}>{accountId}</strong></p>
   <ol className={styles.instructions}>
    <li>联系运营者并提供完整账号 ID，先确认实收金额、积分数量和预计处理时间。</li>
    <li>双方确认后再按约定转账；1 元人民币对应 1000 购买积分。</li>
    <li>运营者核验实际到账后人工入账，您可回个人中心查看购买余额和充值明细。</li>
   </ol>
   <p className={styles.intro}>不承诺全天候处理或即时自动到账。请保留转账凭证，尚未到账时先联系核对，不要重复转账。</p>
  </section>
 </main></div>;
}
