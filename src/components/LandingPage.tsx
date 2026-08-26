"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import styles from "./LandingPage.module.css";

const concerns = [
  ["01", "了解一些 AI 工具，却不知道它们和 AI 产品经理有什么关系", "会用一些 AI 工具，却不知道如何把它们放进真实的产品工作里。"],
  ["02", "还没弄清传统产品经理，更不了解它与 AI 产品经理的区别", "听过很多岗位名称，却很难说清楚他们每天在解决什么问题。"],
  ["03", "资讯越来越多，却不知道从哪里开始学习和运用 AI", "缺乏一条清晰的成长路线，收藏了很多内容，却迟迟没有真正开始。"],
] as const;

const experienceSteps = [
  ["01", "接手任务", "从一段真实的任务背景开始，知道自己要为谁解决什么问题。"],
  ["02", "做出选择", "面对具体场景，判断现在应该先做什么，而不是急着给答案。"],
  ["03", "获得反馈", "看职场前辈如何解释选择，理解不同判断背后的取舍。"],
  ["04", "形成认知", "把一次次判断串起来，理解 AI 产品经理如何思考与推进。"],
] as const;

const workflowSteps = ["需求分析", "原型", "PRD", "任务拆分"] as const;

export default function LandingPage() {
  const [headerHidden, setHeaderHidden] = useState(false);

  useEffect(() => {
    const elements = document.querySelectorAll<HTMLElement>("[data-landing-reveal]");
    if (!("IntersectionObserver" in window)) {
      elements.forEach((element) => element.classList.add(styles.revealVisible));
      return;
    }
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add(styles.revealVisible);
        observer.unobserve(entry.target);
      }
    }), { threshold: 0.14 });
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const scrollTarget: HTMLElement | Window = document.querySelector<HTMLElement>("body > main") ?? window;
    const getScrollY = () => scrollTarget instanceof Window ? window.scrollY : scrollTarget.scrollTop;
    let previousY = getScrollY();
    const onScroll = () => {
      const currentY = getScrollY();
      setHeaderHidden(currentY > previousY && currentY > 120);
      if (currentY < previousY) setHeaderHidden(false);
      previousY = currentY;
    };
    scrollTarget.addEventListener("scroll", onScroll, { passive: true });
    return () => scrollTarget.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className={styles.shell}>
      <aside className={`${styles.sideRail} ${styles.sideRailLeft}`} aria-hidden="true"><span>AI PRODUCT FIELD / 2026</span></aside>
      <aside className={`${styles.sideRail} ${styles.sideRailRight}`} aria-hidden="true"><span>A REAL START / NO SIGN-UP</span></aside>
      <div className={styles.topline}><div className={`${styles.container} ${styles.toplineInner}`}><span className={styles.mono}>AI PRODUCT FIELD / 01</span><span>给还没做过产品的人，一次真实的开始</span></div></div>
      <header className={`${styles.header} ${headerHidden ? styles.headerHidden : ""}`}>
        <div className={`${styles.container} ${styles.nav}`}>
          <a className={styles.brand} href="#top" aria-label="回到顶部"><span className={styles.brandMark}>A</span><span>AI 产品现场</span></a>
          <nav className={styles.navLinks} aria-label="主导航"><a href="#about">职业困惑</a><a href="#how">认识路径</a><a href="#practice">产品实践</a></nav>
          <Link className={styles.authLink} href="/login">注册 / 登录</Link>
        </div>
      </header>
      <main id="top">
        <section className={styles.hero} data-landing-id="hero-section"><div className={`${styles.container} ${styles.heroLayout}`}><div>
          <h1 className={styles.reveal} data-landing-reveal>把对 AI 的好奇，<br /><em>孵化成产品判断</em><span className={styles.dot} /></h1>
          <p className={`${styles.heroCopy} ${styles.reveal}`} data-landing-reveal>无需注册，先进入一场真实的 AI 产品任务，认识这个职业如何思考、判断与推进。</p>
          <div className={`${styles.pathActions} ${styles.reveal}`} data-landing-reveal>
            <Link className={`${styles.pathCard} ${styles.primary}`} href="/onboarding/brief"><span className={styles.pathTop}><span>路径 01</span><span className={styles.pathArrow}>↗</span></span><span className={styles.pathTitle}>先认识 AI 产品经理</span><span className={styles.pathDesc}>无需注册，进入职业认知强流程。</span></Link>
            <Link className={styles.pathCard} href="/projects"><span className={styles.pathTop}><span>路径 02</span><span className={styles.pathArrow}>↗</span></span><span className={styles.pathTitle}>我已经准备好，开始做产品</span><span className={styles.pathDesc}>直接进入需求分析、原型、PRD 与任务拆分。</span></Link>
          </div>
        </div></div></section>
        <section id="about" data-landing-id="about-section"><div className={styles.container}>
          <div className={`${styles.sectionHead} ${styles.reveal}`} data-landing-reveal><span className={styles.sectionNumber}>I / 04</span><div className={styles.sectionIntro}><h2>你是不是也在<br /><em>这里卡住？</em></h2><p className={styles.sectionLead}>不是信息太少，而是还没有一条能让你开始判断的路。</p></div></div>
          <div className={styles.concernList} data-landing-id="concern-list">{concerns.map(([number, title, copy]) => <article className={`${styles.concernItem} ${styles.reveal}`} data-landing-reveal key={number}><span className={styles.concernNum}>{number}</span><h3>{title}</h3><p>{copy}</p></article>)}</div>
        </div></section>
        <section id="how" data-landing-id="how-section"><div className={styles.container}>
          <div className={`${styles.sectionHead} ${styles.reveal}`} data-landing-reveal><span className={styles.sectionNumber}>II / 04</span><div className={styles.sectionIntro}><div className={styles.eyebrow}>先认识 AI 产品经理</div><h2>从接手任务，到<br /><em>形成认知</em><span className={styles.dot} /></h2><p className={styles.sectionLead}>在路径 1 里，你会扮演刚入职的 AI 产品经理，接手“大学生 AI 学习助手”项目，亲自走过一次产品判断。</p></div></div>
          <div className={styles.experienceFlow} data-landing-id="experience-flow">{experienceSteps.map(([number, title, copy]) => <article className={`${styles.experienceStep} ${styles.reveal} ${styles.revealStep}`} data-landing-reveal key={number}><span className={styles.experienceIndex}>{number}</span><h3>{title}</h3><p>{copy}</p></article>)}</div>
          <div className={`${styles.experienceResult} ${styles.reveal}`} data-landing-reveal><p>完成体验后的<strong>十道测试</strong>，全部答对后登录即可查看并下载你的<strong>职业认知文件</strong>。</p><span className={styles.mono}>NO SHORTCUTS / JUST A START</span></div>
        </div></section>
        <section id="practice" className={styles.darkSection} data-landing-id="practice-section"><div className={`${styles.container} ${styles.workflow}`}>
          <div className={styles.reveal} data-landing-reveal><div className={styles.sectionNumber}>III / 04</div><div className={styles.eyebrow}>已经准备好做产品</div><h2>从想法开始，<br />一路到<em>能交付</em><span className={styles.dot} /></h2><p className={styles.sectionLead}>如果你已经知道自己想做什么，可以直接沿着这四个阶段，把想法一步步推进下去。</p><Link className={styles.ctaButton} href="/projects">开始做产品&nbsp; ↗</Link></div>
          <div className={`${styles.workflowList} ${styles.reveal}`} aria-label="产品实践流程" data-landing-reveal>{workflowSteps.map((step, index) => <div className={styles.workflowItem} key={step}><span className={styles.workflowIndex}>0{index + 1}</span><h3>{step}</h3><span className={styles.workflowArrow}>{index === workflowSteps.length - 1 ? "↗" : "→"}</span></div>)}</div>
        </div></section>
        <section data-landing-id="testimonial-section"><div className={`${styles.container} ${styles.quoteLayout}`}><span className={styles.sectionNumber}>IV / 04</span><div><div className={`${styles.quote} ${styles.reveal}`} data-landing-reveal><div className={styles.quoteMark}>“</div><p>我终于知道，AI 产品经理不是一个“懂很多 AI 工具”的岗位，而是一个要不断做取舍的人。</p><small>来自一位正在寻找第一份产品实习的大学生 · 体验反馈示意</small></div></div></div></section>
        <section id="closing" className={styles.cta} data-landing-id="cta-section"><div className={`${styles.container} ${styles.ctaInner}`}><div className={styles.reveal} data-landing-reveal><h2>你的第一个产品现场，<br /><em>现在就开始</em><span className={styles.dot} /></h2><p className={styles.ctaCopy}>不知道从哪里开始，就先走职业认知；已经有想法，就直接开始做产品。</p></div><Link className={styles.ctaButton} href="/onboarding/brief">进入职业认知体验&nbsp; ↗</Link></div></section>
      </main>
      <footer data-landing-id="site-footer"><div className={`${styles.container} ${styles.footerInner}`}><span>© 2026 AI 产品现场</span><div className={styles.footerLinks}><a href="#about">关于现场</a><a href="#practice">产品实践</a><Link href="/login">注册 / 登录</Link></div></div></footer>
    </div>
  );
}
