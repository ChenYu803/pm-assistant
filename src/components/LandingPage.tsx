"use client";

import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
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
const deliverables = [
  { title: "需求分析", file: "需求分析.md", verb: "把问题看清楚", lines: ["用户与真实场景", "问题与证据", "范围与优先级"] },
  { title: "原型", file: "原型.md", verb: "让想法看得见", lines: ["页面与信息结构", "关键交互", "状态与边界"] },
  { title: "PRD", file: "prd.md", verb: "让共识可执行", lines: ["目标与产品范围", "功能与行为", "验收标准"] },
  { title: "任务拆分", file: "issues/", verb: "让交付有下一步", lines: ["实现任务", "依赖与顺序", "完成与验收"] },
] as const;

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return <svg className={styles.arrow} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d={diagonal ? "M6 18 18 6M6 6h12v12" : "M4 12h16m-7-7 7 7-7 7"} /></svg>;
}

/** 使用真实滚动容器；滚动不重复缓动，指针阻尼与帧率无关，静止后停帧。 */
function useLandingMotion(rootRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const hero = root.querySelector<HTMLElement>("[data-artifact-stage]")!;
    const practice = root.querySelector<HTMLElement>("#practice")!;
    const sheets = [...practice.querySelectorAll<HTMLElement>("[data-delivery-sheet]")];
    const steps = [...practice.querySelectorAll<HTMLElement>("[data-delivery-step]")];
    const scroller = root.closest<HTMLElement>("body > main")!;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const finePointer = matchMedia("(hover: hover) and (pointer: fine)");
    const desktop = matchMedia("(min-width: 901px) and (min-height: 740px)");
    let frame = 0, lastTime = 0;
    let x = 0, y = 0, targetX = 0, targetY = 0;
    const clamp = (value: number) => Math.min(1, Math.max(0, value));
    const draw = (time: number) => {
      frame = 0;
      const dt = Math.min((time - (lastTime || time - 16)) / 1000, .05);
      lastTime = time;
      const gain = 1 - Math.exp(-18 * dt);
      x += (targetX - x) * gain;
      y += (targetY - y) * gain;
      if (Math.abs(x - targetX) < .001) x = targetX;
      if (Math.abs(y - targetY) < .001) y = targetY;
      hero.style.setProperty("--aim-x", x.toFixed(4));
      hero.style.setProperty("--aim-y", y.toFixed(4));
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
      if (x !== targetX || y !== targetY) frame = requestAnimationFrame(draw);
    };
    const schedule = () => { if (!frame) { lastTime = 0; frame = requestAnimationFrame(draw); } };
    const reset = () => { targetX = targetY = 0; schedule(); };
    const move = (event: PointerEvent) => {
      if (reduced.matches || !finePointer.matches) return;
      const box = hero.getBoundingClientRect();
      targetX = Math.max(-1, Math.min(1, (event.clientX - box.left) / box.width * 2 - 1));
      targetY = Math.max(-1, Math.min(1, (event.clientY - box.top) / box.height * 2 - 1));
      schedule();
    };
    root.dataset.motion = "ready";
    hero.addEventListener("pointermove", move);
    hero.addEventListener("pointerleave", reset);
    scroller.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    reduced.addEventListener("change", reset);
    finePointer.addEventListener("change", reset);
    const resize = new ResizeObserver(schedule);
    resize.observe(practice);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      hero.removeEventListener("pointermove", move);
      hero.removeEventListener("pointerleave", reset);
      scroller.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      reduced.removeEventListener("change", reset);
      finePointer.removeEventListener("change", reset);
      resize.disconnect();
      delete root.dataset.motion;
    };
  }, [rootRef]);
}

export default function LandingPage() {
  const { data: session, status } = useSession();
  const rootRef = useRef<HTMLDivElement>(null);
  const [artifact, setArtifact] = useState(0);
  useLandingMotion(rootRef);

  return (
    <div className={styles.shell} ref={rootRef}>
      <header className={styles.header}>
        <div className={styles.container + " " + styles.nav}>
          <a className={styles.brand} href="#top" aria-label="回到顶部"><span className={styles.brandMark}>A</span><span>AI 产品现场</span></a>
          <nav className={styles.navLinks} aria-label="主导航"><a href="#about">职业困惑</a><a href="#how">认识路径</a><a href="#practice">产品实践</a></nav>
          {status === "loading" ? <span className={styles.authLink} aria-hidden="true">　</span> : <Link className={styles.authLink} href={session?.user ? "/profile" : "/login"}>{session?.user ? "个人主页" : "注册 / 登录"}</Link>}
        </div>
      </header>
      <main id="top">
        <section className={styles.hero} data-landing-id="hero-section">
          <div className={styles.container + " " + styles.heroLayout}>
            <div className={styles.heroWords}>
              <h1>把对 AI 的好奇，<br /><em>孵化成<br className={styles.desktopBreak} />产品判断。</em></h1>
              <p className={styles.heroCopy}>无需注册，先进入一场真实的 AI 产品任务，认识这个职业如何思考、判断与推进。</p>
              <div className={styles.pathActions}>
                <Link className={styles.primaryAction} href="/onboarding/brief"><span>先认识 AI 产品经理</span><Arrow diagonal /></Link>
                <Link className={styles.secondaryAction} href="/projects"><span>我已经准备好，开始做产品</span><Arrow diagonal /></Link>
              </div>
              <span className={styles.heroFootnote}>从一次判断开始，走向一份能交付的成果。</span>
            </div>
            <div className={styles.artifactStage} data-artifact-stage>
              <div className={styles.artifactCaption}><span>想法，逐步成为成果。</span><span>01 — 04</span></div>
              <div className={styles.artifactSpace}>
                <div className={styles.artifactStack}>
                  {deliverables.map((item, index) => <div key={item.file} className={styles.heroSheet + (index === artifact ? " " + styles.heroSheetActive : "")} style={{ "--sheet": index, "--stack-order": (index - artifact + 4) % 4 } as CSSProperties} aria-hidden={index !== artifact}>
                    <span className={styles.sheetFile}>{item.file}</span><span className={styles.sheetNumber}>0{index + 1}</span>
                    <strong className={styles.sheetTitle}>{item.verb}</strong>
                    <div className={styles.sheetLines}>{item.lines.map((line, i) => <span key={line}><small>0{i + 1}</small>{line}</span>)}</div>
                    <span className={styles.sheetFooter}>AI 产品现场 <span>交付结构示意</span></span>
                  </div>)}
                </div>
              </div>
              <div className={styles.artifactControls} role="group" aria-label="切换成果示意">{deliverables.map((item, index) => <button type="button" key={item.file} aria-pressed={index === artifact} onClick={() => setArtifact(index)}><span>0{index + 1}</span>{item.title}</button>)}</div>
            </div>
          </div>
          <div className={styles.container + " " + styles.heroBottom}><span>认识职业 / 做出判断 / 推进产品</span><a href="#about">往下，走进现场 <Arrow /></a></div>
        </section>

        <section id="about" className={styles.about} data-landing-id="about-section"><div className={styles.container}>
          <div className={styles.sectionHead}><h2>你是不是也在<br /><em>这里卡住？</em></h2><p className={styles.sectionLead}>不是信息太少，而是还没有一条能让你开始判断的路。</p></div>
          <div className={styles.concernList} data-landing-id="concern-list">{concerns.map(([number, title, copy]) => <article className={styles.concernItem} key={number}><span className={styles.concernNum}>{number}</span><h3>{title}</h3><p>{copy}</p></article>)}</div>
        </div></section>

        <section id="how" className={styles.how} data-landing-id="how-section"><div className={styles.container}>
          <div className={styles.sectionHead}><h2>从接手任务，到<br /><em>形成认知。</em></h2><p className={styles.sectionLead}>在路径 1 里，你会扮演刚入职的 AI 产品经理，接手“大学生 AI 学习助手”项目，亲自走过一次产品判断。</p></div>
          <div className={styles.experienceFlow} data-landing-id="experience-flow">{experienceSteps.map(([number, title, copy]) => <article className={styles.experienceStep} key={number}><span className={styles.experienceIndex}>{number}</span><h3>{title}</h3><p>{copy}</p></article>)}</div>
          <div className={styles.experienceResult}><p>完成体验后的<strong>十道测试</strong>，提交后即可进入认知文件入口；登录后可以查看并下载你的<strong>职业认知文件</strong>。</p><Link href="/onboarding/brief">进入职业认知体验 <Arrow diagonal /></Link></div>
        </div></section>

        <section id="practice" className={styles.practice} data-landing-id="practice-section" data-progress="0" data-phase="0">
          <div className={styles.container + " " + styles.practicePin}>
            <div className={styles.workflowIntro}><h2>从想法开始，<br />一路到<em>能交付。</em></h2><p className={styles.sectionLead}>如果你已经知道自己想做什么，可以直接沿着这四个阶段，把想法一步步推进下去。</p>
              <ol className={styles.workflowList} aria-label="产品实践流程">{deliverables.map((item, index) => <li key={item.file} className={styles.workflowItem} data-delivery-step data-active={index === 0 ? "true" : "false"}><span>0{index + 1}</span><h3>{item.title}</h3><Arrow /></li>)}</ol>
              <Link className={styles.primaryAction} href="/projects">开始做产品 <Arrow diagonal /></Link>
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

        <section className={styles.testimonial} data-landing-id="testimonial-section"><div className={styles.container + " " + styles.quoteLayout}><span className={styles.quoteMark} aria-hidden="true">“</span><blockquote><p>我终于知道，AI 产品经理不是一个“懂很多 AI 工具”的岗位，而是一个要不断做取舍的人。</p><footer>来自一位正在寻找第一份产品实习的大学生 · 体验反馈示意</footer></blockquote></div></section>
        <section id="closing" className={styles.cta} data-landing-id="cta-section"><div className={styles.container + " " + styles.ctaInner}><div><h2>你的第一个产品现场，<br /><em>现在就开始。</em></h2><p className={styles.ctaCopy}>不知道从哪里开始，就先走职业认知；已经有想法，就直接开始做产品。</p></div><Link className={styles.primaryAction} href="/onboarding/brief">进入职业认知体验 <Arrow diagonal /></Link></div></section>
      </main>
      <footer className={styles.siteFooter} data-landing-id="site-footer"><div className={styles.container + " " + styles.footerInner}><span>© 2026 AI 产品现场</span><div className={styles.footerLinks}><a href="#about">关于现场</a><a href="#practice">产品实践</a>{status !== "loading" && <Link href={session?.user ? "/profile" : "/login"}>{session?.user ? "个人主页" : "注册 / 登录"}</Link>}</div></div></footer>
    </div>
  );
}
