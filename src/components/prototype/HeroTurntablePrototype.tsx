"use client";

/**
 * 原型沙盒：只渲染首屏这一段，右侧换成正式的 <HeroTurntable />。
 *
 * 这个文件是一次性外壳，用来在没有登录、没有页面实现的情况下单看首屏；
 * 正式页 src/components/LandingPage.tsx 用的是同一个组件，两边不会走样。
 */
import Link from "next/link";
import HeroTurntable from "@/components/HeroTurntable";
import landing from "@/components/LandingPage.module.css";
import styles from "./HeroTurntablePrototype.module.css";

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return <svg className={landing.arrow} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d={diagonal ? "M6 18 18 6M6 6h12v12" : "M4 12h16m-7-7 7 7-7 7"} /></svg>;
}

export default function HeroTurntablePrototype() {
  return (
    <div className={landing.shell} data-prototype="hero-turntable">
      <header className={landing.header}>
        <div className={landing.container + " " + landing.nav}>
          <a className={landing.brand} href="#top" aria-label="AI 产品现场"><span className={landing.brandMark}>A</span><span>AI 产品现场</span></a>
          <nav className={landing.navLinks + " " + styles.inertNav} aria-label="主导航"><span>职业困惑</span><span>认识路径</span><span>产品实践</span></nav>
          <span className={landing.authLink}>注册 / 登录</span>
        </div>
      </header>

      <section className={landing.hero} id="top" data-landing-id="hero-section">
        <div className={landing.container + " " + landing.heroLayout}>
          <div className={landing.heroWords}>
            <h1>
              把对 AI 的好奇，<br />
              <em>孵化成<br className={landing.desktopBreak} />产品判断。</em>
            </h1>
            <p className={landing.heroCopy}>无需注册，先进入一场真实的 AI 产品任务，认识这个职业如何思考、判断与推进。</p>
            <div className={landing.pathActions}>
              <Link className={landing.primaryAction} href="/onboarding/brief"><span>先认识 AI 产品经理</span><Arrow diagonal /></Link>
              <Link className={landing.secondaryAction} href="/projects"><span>我已经准备好，开始做产品</span><Arrow diagonal /></Link>
            </div>
            <span className={landing.heroFootnote}>从一次判断开始，走向一份能交付的成果。</span>
          </div>

          <HeroTurntable />
        </div>

        <div className={landing.container + " " + landing.heroBottom}>
          <span>认识职业 / 做出判断 / 推进产品</span>
          <span className={styles.inertAction}>往下，走进现场 <Arrow /></span>
        </div>
      </section>

      <div className={styles.bar}>
        <b>Prototype</b>
        <span>转台可以拖——四个面是同一份成果</span>
        <Link href="/">退出原型</Link>
      </div>
    </div>
  );
}
