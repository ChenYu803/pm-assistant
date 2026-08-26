import Link from "next/link";
import styles from "./OnboardingExperience.module.css";

const briefItems = [
  ["你要做什么", "协助团队研发一款帮助大学生完成学业学习的 AI 产品，先从理解真实需求开始。"],
  ["谁会帮助你", "一位职场前辈会和你一起工作。他不会直接替你做决定，而是解释每一个选择背后的理由。"],
  ["你会经历什么", "在一系列工作场景中做判断，看到反馈，再逐渐理解 AI 产品经理如何推进工作。"],
] as const;

export default function OnboardingBrief() {
  return (
    <div className={`${styles.page} ${styles.briefPage}`}>
      <div className={styles.topline}><div className={`${styles.container} ${styles.toplineInner}`}><span className={styles.mono}>AI PRODUCT FIELD / ONBOARDING</span><span>一个真实的开始，不需要先注册</span></div></div>
      <header className={`${styles.nav} ${styles.container}`}>
        <Link className={styles.brand} href="/"><span className={styles.brandMark} aria-hidden="true">A</span><span>AI 产品现场</span></Link>
        <Link className={styles.navBack} href="/">返回入口<span className={styles.arrow} aria-hidden="true" /></Link>
      </header>
      <div className={styles.briefMain}>
        <section className={`${styles.container} ${styles.briefHero}`} data-od-id="mission-hero">
          <div className={styles.heroCopyBlock}>
            <p className={styles.eyebrow}>AI 产品经理入职体验 · 任务简报</p>
            <h1>欢迎加入。<br /><em>先从一个任务开始。</em></h1>
            <p className={styles.heroCopy}>你刚加入一家 AI 教育产品公司。今天，你将第一次以 AI 产品经理的身份，和一位优秀的前辈一起接手一个真实问题。</p>
            <div className={`${styles.heroIndex} ${styles.mono}`}><span className={styles.indexLine} aria-hidden="true" /><span>现场 01 · 09:00</span></div>
          </div>
          <div className={styles.missionCard} data-od-id="mission-card">
            <div className={styles.cardKicker}>INCOMING / 09:00 AM</div>
            <div className={styles.cardTitle}>大学生<br /><em>AI 学习助手</em></div>
            <div className={styles.cardRule}><div><strong>你的身份</strong>刚入职的 AI 产品经理</div><div><strong>协作对象</strong>一位愿意带你的职场前辈</div></div>
          </div>
        </section>
        <section className={styles.briefSection} data-od-id="mission-context">
          <div className={styles.container}>
            <div className={styles.sectionHead}><span className={styles.sectionNumber}>01 / 03</span><div><p className={styles.eyebrow}>THE ASSIGNMENT</p><h2>思考。先不要急着<br /><em>做出答案。</em></h2></div></div>
            <div className={styles.briefGrid}>{briefItems.map(([title, copy], index) => <article className={styles.briefItem} data-od-id={`brief-${["role", "mentor", "rule"][index]}`} key={title}><h3>{title}</h3><p>{copy}</p></article>)}</div>
          </div>
        </section>
        <section className={styles.briefSection} data-od-id="mission-start">
          <div className={`${styles.container} ${styles.briefAction}`}>
            <div><p className={styles.eyebrow}>YOUR FIRST MOVE</p><h2>准备好就<br /><em>开始工作。</em></h2><p>无需注册。你的体验会从当前浏览器继续，选择只影响当下的反馈，不会改变任务路线。</p></div>
            <Link className={styles.primary} href="/onboarding/scenes?scene=1" data-od-id="enter-first-scene">进入第一个工作场景<span className={styles.arrow} aria-hidden="true" /></Link>
          </div>
        </section>
      </div>
    </div>
  );
}
