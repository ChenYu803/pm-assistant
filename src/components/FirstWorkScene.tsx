"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import styles from "./OnboardingExperience.module.css";

const methods = [
  ["survey", "问卷调查", "快速收集大量学生的共性反馈"],
  ["interview", "用户访谈", "深入理解学生的动机、困扰和表达背后的原因"],
  ["observation", "学习行为观察", "观察真实学习过程，而不是只听用户回忆"],
  ["competitor", "竞品与案例研究", "了解已有方案如何回应相似需求"],
] as const;

export default function FirstWorkScene() {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const feedbackRef = useRef<HTMLDivElement>(null);
  const complete = submitted && selected.size === methods.length;
  const missing = methods.filter(([value]) => !selected.has(value)).map(([, label]) => label);
  const selectedNames = methods.filter(([value]) => selected.has(value)).map(([, label]) => label);

  function toggle(value: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(value)) next.delete(value); else next.add(value);
      return next;
    });
    setSubmitted(false);
  }

  function submitChoice() {
    setSubmitted(true);
    window.requestAnimationFrame(() => feedbackRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  return (
    <div className={`${styles.page} ${styles.scenePage}`}>
      <div className={styles.topline}><div className={`${styles.container} ${styles.toplineInner}`}><span>AI PRODUCT FIELD / WORK SCENE 01</span><span>你的选择不会改变后续路线</span></div></div>
      <header className={`${styles.nav} ${styles.container}`}>
        <Link className={styles.brand} href="/onboarding/brief"><span className={styles.brandMark} aria-hidden="true">A</span><span>AI 产品现场</span></Link>
        <Link className={styles.navBack} href="/onboarding/brief">← 返回任务简报</Link>
      </header>
      <section className={`${styles.container} ${styles.sceneIntro}`} data-od-id="scene-intro"><span className={styles.sceneNo}>01 / 05</span><div><p className={styles.eyebrow}>工作场景一 · 需求收集</p><h1>会议室里，前辈问你：<br /><em>我们该从哪里开始？</em></h1><p>项目还没有开始写功能。你需要先确认大学生在学习中真正遇到了什么问题。现在，请判断哪些方法可以用来收集需求。</p></div></section>
      <section className={styles.workbench} data-od-id="scene-workbench"><div className={`${styles.container} ${styles.workGrid}`}><div className={styles.context}><span className={styles.contextLabel}>THE FIRST QUESTION</span><h2>别急着<br />替用户想。</h2><p>需求收集的目标，是尽可能接近真实用户的处境。方法没有唯一答案，关键在于让信息从不同角度浮现出来。</p></div><div className={styles.questionBox}>
        <div className={styles.questionMeta}><span>多选题 / 可选择多个</span><span>已选 {selected.size} 项</span></div>
        <h2>你可以使用哪些方法进行需求收集？</h2><p className={styles.questionHelp}>选出你认为可行的全部方法，再提交给前辈。</p>
        <div className={styles.options} role="group" aria-label="需求收集方法">{methods.map(([value, label, description]) => <label className={`${styles.option} ${selected.has(value) ? styles.optionSelected : ""}`} key={value}><input type="checkbox" checked={selected.has(value)} onChange={() => toggle(value)} /><span className={styles.check} aria-hidden="true">✓</span><span className={styles.optionCopy}><strong>{label}</strong><span>{description}</span></span></label>)}</div>
        <div className={styles.submitRow}><span className={styles.submitNote}>提示：真实工作中，通常需要组合使用多种方法。</span><button className={styles.scenePrimary} type="button" onClick={submitChoice} data-od-id="submit-choice">提交我的判断&nbsp; ↗</button></div>
        <div ref={feedbackRef} className={`${styles.feedback} ${submitted ? styles.feedbackVisible : ""}`} data-od-id="mentor-feedback"><div className={styles.feedbackTop}><h3>前辈的反馈</h3><span className={styles.feedbackStatus}>{selected.size === 0 ? "还没有选择" : complete ? "判断成立" : "再想一步"}</span></div><p>{selected.size === 0 ? "先不用急着提交答案。试着从“如何获得真实证据”出发，选出你认为可行的方法。" : complete ? "你的判断成立。很好，你没有把需求收集缩减成单一方法，前辈会和你一起把这些证据拼起来。" : "你选中了其中一部分。前辈提醒你：这些都可以使用。错误不会让任务失败，回到问题本身再看一遍。"}</p><div className={styles.feedbackColumns}><div><strong>你的选择</strong><p>{selectedNames.length ? `${selectedNames.join("、")}${missing.length ? `。还可以选择：${missing.join("、")}` : ""}` : "尚未选择"}</p></div><div><strong>前辈的纠正</strong><p>{selected.size === 0 ? "四种方法都可以使用：问卷调查、用户访谈、学习行为观察和竞品与案例研究。" : complete ? "四种方法都可以使用。不同方法提供不同证据，组合使用才能避免只听见单一声音。" : `你漏选了${missing.join("、")}。它们同样能帮助团队接近真实需求，不是“错误方法”。`}</p></div></div></div>
      </div></div></section>
      <section className={styles.mentor} data-od-id="mentor-quote"><div className={`${styles.container} ${styles.mentorInner}`}><div className={styles.mentorCopy}><span className={styles.mentorMark}>“</span><div><p>先把问题看清楚，再讨论要不要做功能。产品经理的第一步，常常是认真听。</p><small>你的前辈 · AI 教育产品团队</small></div></div>{complete ? <Link className={`${styles.scenePrimary} ${styles.continue}`} href="/onboarding/scenes?scene=2" data-od-id="continue-scene">进入下一个工作场景&nbsp; ↗</Link> : null}</div></section>
    </div>
  );
}
