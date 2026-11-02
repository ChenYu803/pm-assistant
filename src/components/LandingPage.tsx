"use client";

import { useEffect, useRef, type CSSProperties, type RefObject } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import styles from "./LandingPage.module.css";
import HeroTurntable from "./HeroTurntable";
import { deliverables } from "./landingDeliverables";

const concerns = [
  ["01", "了解一些 AI 工具，却不知道它们和 AI 产品经理有什么关系", "会用一些 AI 工具，却不知道如何把它们放进真实的产品工作里。"],
  ["02", "还没弄清传统产品经理，更不了解它与 AI 产品经理的区别", "听过很多岗位名称，却很难说清楚他们每天在解决什么问题。"],
  ["03", "资讯越来越多，却不知道从哪里开始学习和运用 AI", "缺乏一条清晰的成长路线，收藏了很多内容，却迟迟没有真正开始。"],
] as const;
const experienceSteps = [
  ["01", "接手任务", "从一段真实的任务背景开始，知道自己要为谁解决什么问题。"],
  ["02", "做出选择", "面对具体场景，先判断问题与下一步，再形成清晰答案。"],
  ["03", "获得反馈", "看职场前辈如何解释选择，理解不同判断背后的取舍。"],
  ["04", "形成认知", "把一次次判断串起来，理解 AI 产品经理如何思考与推进。"],
] as const;
function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return <svg className={styles.arrow} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d={diagonal ? "M6 18 18 6M6 6h12v12" : "M4 12h16m-7-7 7 7-7 7"} /></svg>;
}

/** 产品实践区的滚动接力：用真实滚动位置算 progress / phase，静止后不再续帧。 */
function useLandingMotion(rootRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const practice = root.querySelector<HTMLElement>("#practice")!;
    const sheets = [...practice.querySelectorAll<HTMLElement>("[data-delivery-sheet]")];
    const steps = [...practice.querySelectorAll<HTMLElement>("[data-delivery-step]")];
    const scroller = root.closest<HTMLElement>("body > main")!;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const desktop = matchMedia("(min-width: 901px) and (min-height: 740px)");
    let frame = 0;
    const clamp = (value: number) => Math.min(1, Math.max(0, value));
    const draw = () => {
      frame = 0;
      const bounds = practice.getBoundingClientRect();
      const top = scroller.getBoundingClientRect().top;
      const progress = reduced.matches || !desktop.matches ? 0 : clamp((top - bounds.top) / Math.max(1, bounds.height - scroller.clientHeight));
      practice.dataset.progress = progress.toFixed(4);
      const phase = Math.min(3, Math.floor(progress * 3 + .35));
      practice.dataset.phase = String(phase);
      sheets.forEach((sheet, index) => {
        sheet.style.setProperty("--passed", String(clamp(progress * 3 - index)));
        sheet.style.setProperty("--distance", String(Math.max(0, index - progress * 3)));
      });
      steps.forEach((step, index) => { step.dataset.active = String(index === phase); });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(draw); };
    root.dataset.motion = "ready";
    scroller.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    reduced.addEventListener("change", schedule);
    const resize = new ResizeObserver(schedule);
    resize.observe(practice);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      reduced.removeEventListener("change", schedule);
      resize.disconnect();
      delete root.dataset.motion;
    };
  }, [rootRef]);
}

export default function LandingPage() {
  const { data: session, status } = useSession();
  const rootRef = useRef<HTMLDivElement>(null);
  useLandingMotion(rootRef);

  return (
    <div className={styles.shell} ref={rootRef}>
      <main id="top">
        <section className={styles.hero} data-landing-id="hero-section">
          <div className={styles.container + " " + styles.heroLayout}>
            <div className={styles.heroWords}>
              <h1>把对 AI 的好奇，<br /><em>孵化成<br className={styles.desktopBreak} />产品判断。</em></h1>
              <p className={styles.heroCopy}>无需注册，先进入一场真实的 AI 产品任务，认识这个职业如何思考、判断与推进。</p>
              <div className={styles.pathActions}>
                <Link className={styles.primaryAction} href="/onboarding/brief"><span>先认识 AI 产品经理</span><Arrow diagonal /></Link>
                <Link className={styles.secondaryAction} href="/projects"><span>我准备好了</span><Arrow diagonal /></Link>
              </div>
              <span className={styles.heroFootnote}>从一次判断开始，走向一份能交付的成果。</span>
            </div>
            <div className={styles.artifactStage}><HeroTurntable /></div>
          </div>
          <div className={styles.container + " " + styles.heroBottom}><span>认识职业 / 做出判断 / 推进产品</span><a href="#about">往下，走进现场 <Arrow /></a></div>
        </section>

        <section id="about" className={styles.about} data-landing-id="about-section"><div className={styles.container}>
          <div className={styles.sectionHead + " " + styles.sectionHeadSingle}><h2>你可能正在面对<br /><em>这些困惑。</em></h2></div>
          <div className={styles.concernList} data-landing-id="concern-list">{concerns.map(([number, title, copy]) => <article className={styles.concernItem} key={number}><span className={styles.concernNum}>{number}</span><h3>{title}</h3><p>{copy}</p></article>)}</div>
        </div></section>

        <section id="how" className={styles.how} data-landing-id="how-section"><div className={styles.container}>
          <div className={styles.sectionHead}><h2>从接手任务，到<br /><em>形成认知。</em></h2><p className={styles.sectionLead}>在路径 1 里，你会扮演刚入职的 AI 产品经理，接手“大学生 AI 学习助手”项目，亲自走过一次产品判断。</p></div>
          <div className={styles.experienceFlow} data-landing-id="experience-flow">{experienceSteps.map(([number, title, copy]) => <article className={styles.experienceStep} key={number}><span className={styles.experienceIndex}>{number}</span><h3>{title}</h3><p>{copy}</p></article>)}</div>
          <div className={styles.experienceResult}><p>完成体验后的<strong>十道测试</strong>，提交后即可进入认知文件入口；登录后可以查看并下载你的<strong>职业认知文件</strong>。</p><Link href="/onboarding/brief">进入职业认知体验</Link></div>
        </div></section>

        <section id="practice" className={styles.practice} data-landing-id="practice-section" data-progress="0" data-phase="0">
          <div className={styles.container + " " + styles.practicePin}>
            <div className={styles.workflowIntro}><h2>从想法开始，<br />一路到<em>能交付。</em></h2><p className={styles.sectionLead}>如果你已经知道自己想做什么，可以直接沿着这四个阶段，把想法一步步推进下去。</p>
              <ol className={styles.workflowList} aria-label="产品实践流程">{deliverables.map((item, index) => <li key={item.file} className={styles.workflowItem} data-delivery-step data-active={index === 0 ? "true" : "false"}><span>0{index + 1}</span><h3>{item.title}</h3><Arrow /></li>)}</ol>
              <Link className={styles.primaryAction} href="/projects">开始做产品</Link>
            </div>
            <div className={styles.deliveryStage}>
              <div className={styles.deliveryCaption}><span>每一步，都留下可继续的成果</span><span>需求 → 交付</span></div>
              <div className={styles.deliveryDeck}>{deliverables.map((item, index) => <article className={styles.deliverySheet} data-delivery-sheet style={{ "--sheet": index, "--distance": index } as CSSProperties} key={item.file}>
                <span className={styles.sheetFile}>{item.file}</span><span className={styles.sheetNumber}>0{index + 1}</span><h3>{item.verb}</h3><div className={styles.sheetLines}>{item.lines.map((line, i) => <span key={line}><small>0{i + 1}</small>{line}</span>)}</div><span className={styles.sheetFooter}>{item.title}<span>交付结构示意</span></span>
              </article>)}</div>
              <div className={styles.deliveryFootnote}><span>由你确认，每一步的成果。</span><Arrow diagonal /></div>
            </div>
          </div>
        </section>

        <section id="closing" className={styles.cta} data-landing-id="cta-section"><div className={styles.container + " " + styles.ctaInner}><div><h2>你的第一个产品现场，<br /><em>现在就开始。</em></h2><p className={styles.ctaCopy}>不知道从哪里开始，就先走职业认知；已经有想法，就直接开始做产品。</p></div><Link className={styles.primaryAction} href="/onboarding/brief">进入职业认知体验</Link></div></section>
      </main>
      <footer className={styles.siteFooter} data-landing-id="site-footer"><div className={styles.container + " " + styles.footerInner}><span>© 2026 AI 产品现场</span><div className={styles.footerLinks}><a href="#about">关于现场</a><a href="#practice">产品实践</a>{status !== "loading" && <Link href={session?.user ? "/profile" : "/login"}>{session?.user ? "个人主页" : "注册 / 登录"}</Link>}</div></div></footer>
    </div>
  );
}
