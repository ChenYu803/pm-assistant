"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useEffect, useMemo, useState } from "react";
import { assessmentQuestions, type AssessmentQuestion } from "@/lib/assessment-content";
import { CAREER_DOCUMENT_DOWNLOAD_PATH } from "@/lib/career-document";
import styles from "./CareerAssessment.module.css";

type View = "intro" | "test" | "result";
type Modal = "submit" | "restart" | null;

function scrollPageTop(behavior: ScrollBehavior = "auto") {
  const scrollTarget = document.querySelector<HTMLElement>("body > main");
  scrollTarget?.scrollTo({ top: 0, behavior });
  window.scrollTo({ top: 0, behavior });
}

function scheduleFrame(callback: () => void) {
  if (typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(callback);
  } else {
    window.setTimeout(callback, 0);
  }
}

function answerLabel(question: AssessmentQuestion, letter: string | undefined) {
  if (!letter) return "尚未选择";
  return `${letter} · ${question.options.find((option) => option.letter === letter)?.text ?? ""}`;
}

export default function CareerAssessment() {
  const { data: session, status: sessionStatus } = useSession();
  const [view, setView] = useState<View>("intro");
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [modal, setModal] = useState<Modal>(null);

  const answeredCount = Object.keys(answers).length;
  const score = useMemo(
    () => assessmentQuestions.reduce((total, question, index) => total + (answers[index] === question.correct ? 1 : 0), 0),
    [answers],
  );
  const isMember = sessionStatus === "authenticated" && !!session?.user;
  const documentHref = isMember
    ? CAREER_DOCUMENT_DOWNLOAD_PATH
    : `/login?callbackUrl=${encodeURIComponent(CAREER_DOCUMENT_DOWNLOAD_PATH)}`;

  useEffect(() => {
    if (view !== "test") return;
    const elements = document.querySelectorAll<HTMLElement>("[data-assessment-reveal]");
    if (!("IntersectionObserver" in window)) {
      elements.forEach((element) => element.classList.add(styles.revealVisible));
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add(styles.revealVisible);
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [view]);

  useEffect(() => {
    if (!modal) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setModal(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [modal]);

  function startTest() {
    setAnswers({});
    setView("test");
    scheduleFrame(() => scrollPageTop());
  }

  function selectAnswer(index: number, letter: string) {
    setAnswers((current) => ({ ...current, [index]: letter }));
  }

  function submitTest() {
    if (answeredCount !== assessmentQuestions.length) return;
    setModal("submit");
  }

  function showResult() {
    setModal(null);
    setView("result");
    scheduleFrame(() => scrollPageTop("smooth"));
  }

  function restartTest() {
    setModal(null);
    setAnswers({});
    setView("intro");
    scheduleFrame(() => scrollPageTop("smooth"));
  }

  return (
    <div className={styles.page}>
      {view === "intro" ? (
        <section className={styles.introView}>
          <div className={styles.topline}><div className={styles.container}><span className={styles.mono}>AI PRODUCT FIELD / ASSESSMENT</span><span>完成体验后，做一次新的判断</span></div></div>
          <header className={`${styles.nav} ${styles.container}`}>
            <Link className={styles.brand} href="/onboarding/brief"><span className={styles.brandMark}>A</span><span>AI 产品现场</span></Link>
            <Link className={styles.navBack} href="/onboarding/brief">返回任务简报<span className={styles.arrow} aria-hidden="true" /></Link>
          </header>
          <section className={`${styles.container} ${styles.hero}`}>
            <div className={styles.heroCopy}>
              <p className={styles.eyebrow}>AI 产品经理入职体验 · 职业认知测试</p>
              <h1>把判断带到<br /><em>新的教育业务里。</em></h1>
              <p className={styles.heroLead}>你已经完成了第一个项目。接下来，面对新的用户、目标和约束，看看自己会如何做出下一步产品决策。</p>
              <div className={`${styles.heroIndex} ${styles.mono}`}><span className={styles.indexLine} aria-hidden="true" /><span>FINAL CHECK · 10 QUESTIONS</span></div>
            </div>
            <div className={styles.contextCard}>
              <span className={`${styles.contextKicker} ${styles.mono}`}>AFTER THE FIRST WIN / 09:00 AM</span>
              <h2>你的第一个项目<br /><em>大获成功。</em></h2>
              <div className={styles.contextRule}><strong>然后呢？</strong>优秀的你受到了公司的器重。但是，你所要做的产品抉择也自然而然地困难起来。十道新的教育业务情境题，等你把已经形成的判断带到下一现场。</div>
            </div>
          </section>
          <section className={`${styles.container} ${styles.startSection}`}>
            <div className={styles.startGrid}>
              <span className={`${styles.sectionNumber} ${styles.mono}`}>01 / 03</span>
              <div className={styles.startCopy}>
                <p className={styles.eyebrow}>THE NEXT BRIEF</p>
                <h2>先看清规则，<br /><em>再开始判断。</em></h2>
                <p>接下来是十道新的教育业务情境题。它们不会重复刚才的工作场景，而是邀请你面对新的用户、目标和约束，做出一次产品决策。</p>
                <p className={styles.noPass}>提交十道题后，本轮测试即完成，不设置及格线。分数只用于帮助你发现值得复盘的判断。</p>
                <button className={styles.primary} type="button" onClick={startTest}>开始测试<span className={styles.arrow} aria-hidden="true" /></button>
              </div>
            </div>
            <div className={styles.rules}>
              <div className={styles.rule}><strong>每题一个选择</strong><p>每题只有一个综合最优答案，共十题。</p></div>
              <div className={styles.rule}><strong>完成后看结果</strong><p>提交后查看本轮得分和逐题解析，答错不会中断体验。</p></div>
              <div className={styles.rule}><strong>没有及格线</strong><p>分数只帮助你发现值得复盘的判断，不代表职业能力或岗位适配度。</p></div>
            </div>
          </section>
        </section>
      ) : null}

      {view === "test" ? (
        <section className={styles.testView}>
          <div className={styles.darkTopline}><div className={styles.container}><span className={styles.mono}>AI PRODUCT FIELD / ASSESSMENT</span><span>单页连续作答 · 可随时修改</span></div></div>
          <header className={`${styles.darkNav} ${styles.container}`}>
            <Link className={styles.brand} href="/onboarding/brief"><span className={styles.brandMark}>A</span><span>AI 产品现场</span></Link>
            <span className={styles.navBack}>职业认知测试</span>
          </header>
          <header className={styles.testHead}><div className={`${styles.container} ${styles.testHeadGrid}`}><span className={`${styles.sectionNumber} ${styles.mono}`}>02 / 03</span><div><p className={styles.eyebrow}>THE ASSESSMENT</p><h2>请选择一个在当前约束下<br /><em>最值得先做的判断。</em></h2><p>这是一份体验回顾，不是职业能力测评。请按题干给出的业务、资源和风险约束作答，十题全部选择后即可提交。</p><div className={styles.testBar}><span className={styles.mono}>第 <b>{answeredCount}</b> / 10 题</span><span className={styles.testBarLine}><span style={{ width: `${answeredCount * 10}%` }} /></span><span className={styles.mono}>完成十题后查看本轮结果</span></div></div></div></header>
          <div className={styles.questionArea}>
            <div className={styles.container}>
              <div className={styles.questionIntro}>
                <div>
                  <p className={styles.eyebrow}>THE DECISION ROOM</p>
                  <h2>十个新现场，<br /><em>一次完整判断。</em></h2>
                </div>
                <p>滚动浏览全部题目。每道题都只有一个综合最优答案。</p>
              </div>
            {assessmentQuestions.map((question, index) => {
              const selected = answers[index];
              return <section className={styles.questionSession} data-assessment-reveal key={question.number} style={{ "--question-index": index } as React.CSSProperties}>
                <span className={`${styles.questionNo} ${styles.mono}`}>{question.number} / 10</span>
                <div className={styles.questionContent}>
                  <span className={`${styles.questionKicker} ${styles.mono}`}>SITUATION {question.number}</span>
                  <h3>{question.prompt}</h3>
                  <p className={styles.questionContext}>{question.context}</p>
                  <div className={styles.options} role="radiogroup" aria-label={question.title}>
                    {question.options.map((option) => <button className={`${styles.option} ${selected === option.letter ? styles.optionSelected : ""}`} type="button" role="radio" aria-checked={selected === option.letter} key={option.letter} onClick={() => selectAnswer(index, option.letter)}><span className={styles.optionMark}>{option.letter}</span><span className={styles.optionCopy}>{option.text}</span></button>)}
                  </div>
                  <div className={styles.questionFooter}><span className={styles.answerState}>{selected ? `已选择 ${selected} · 可以继续往下判断` : "尚未选择答案"}</span><span className={styles.mono}>单选题</span></div>
                </div>
              </section>;
            })}
            </div>
          </div>
          <div className={styles.submitWrap}><div className={styles.container}><button className={styles.submit} type="button" disabled={answeredCount !== assessmentQuestions.length} onClick={submitTest}>{answeredCount === assessmentQuestions.length ? "查看测试结果" : "请选择答案"}</button></div></div>
        </section>
      ) : null}

      {view === "result" ? (
        <section className={styles.resultView}>
          <div className={styles.darkTopline}><div className={styles.container}><span className={styles.mono}>AI PRODUCT FIELD / ASSESSMENT</span><span>一份体验回顾，不是能力结论</span></div></div>
          <header className={styles.resultHead}><div className={`${styles.container} ${styles.resultGrid}`}><span className={`${styles.sectionNumber} ${styles.mono}`}>03 / 03</span><div><p className={styles.eyebrow}>THE REVIEW</p><h1>本轮测试完成。</h1><div className={styles.score}><span>{score}</span><small>/ 10 题答对</small></div><p className={styles.resultNote}>这份分数只记录本轮固定题目的作答情况，不代表你的职业能力或岗位适配度。</p></div></div></header>
          <section className={styles.reviewSection}><div className={styles.container}><div className={styles.reviewHeading}><div><p className={styles.eyebrow}>MENTOR REVIEW</p><h2>值得复盘的判断（{assessmentQuestions.length - score} 题）</h2></div><p>逐题解析默认展开。你可以先读完本轮反馈，再决定是否开始新一轮测试。</p></div><div className={styles.reviewList}>{assessmentQuestions.map((question, index) => {
            const selected = answers[index];
            const isCorrect = selected === question.correct;
            const selectedText = answerLabel(question, selected);
            const feedback = (isCorrect ? question.correctFeedback : question.wrongFeedback).replace("{selected_option}", selectedText);
            return <article className={styles.reviewItem} key={question.number}><div className={styles.reviewMeta}><span>题目 {question.number} / 10</span><span className={isCorrect ? styles.correct : styles.needsReview}>{isCorrect ? "判断一致" : "值得复盘"}</span></div><p className={styles.reviewKicker}>{question.title} · {question.focus}</p><h3>{question.prompt}</h3><div className={styles.reviewAnswer}><div><strong>你的选择</strong><p>{selectedText}</p></div><div className={styles.correct}><strong>综合最优答案</strong><p>{answerLabel(question, question.correct)}</p></div></div><details className={styles.reviewExpand} open><summary>前辈复盘 · {isCorrect ? question.correctFeedbackTitle : question.wrongFeedbackTitle}</summary><p>{feedback}</p><p><b>项目动作：</b>{question.projectAction}</p>{question.options.map((option) => <p key={option.letter}><b>{option.letter}：</b>{question.optionAnalyses[option.letter]}</p>)}</details></article>;
          })}</div></div></section>
          <section className={styles.completion}><div className={`${styles.container} ${styles.completionInner}`}><div><p className={styles.eyebrow}>COMPLETION NOTE</p><h2>{score === assessmentQuestions.length ? "你完成了这次职业认知检查" : "你完成了本轮判断"}</h2>{score === assessmentQuestions.length ? <><p>十题全对，恭喜你完成了本轮全部判断！</p><p className={styles.boundary}>这不是一张职业能力证书，也不代表你已经达到任何岗位标准。</p></> : <><p>你答对了 {score} 题。错题不是结论，而是下一次复盘的线索。你可以先读逐题解析，也可以直接开始新一轮测试。</p><p className={styles.boundary}>重新测试不会覆盖本轮记录，也不限次数。</p></>}<div className={styles.resultActions}><button className={styles.secondary} type="button" onClick={() => setModal("restart")}>重新测试</button><Link className={styles.resultPrimary} href={documentHref}>获取精炼学习笔记<span className={styles.arrow} aria-hidden="true" /></Link></div></div><div className={styles.entryNote}><strong>{isMember ? "下载 AI 产品经理精炼学习笔记" : "登录后下载精炼学习笔记"}</strong><p>{isMember ? "点击后浏览器会立即下载产品预先编写的固定 Markdown 文件。" : "登录或注册成功后，浏览器会立即下载固定的 Markdown 文件。"}</p></div></div></section>
        </section>
      ) : null}

      {modal ? <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null); }}><div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="assessment-modal-title"><p className={styles.eyebrow}>请确认</p><h2 id="assessment-modal-title">{modal === "submit" ? "提交这轮答案吗？" : "再来一次？"}</h2><p>{modal === "submit" ? "提交后会显示本轮得分和逐题解析。你仍然可以不限次数重新测试。" : "你可以不限次数重试，直到你满意为止。重试会清空目前所有答案与解析，并重新回到测试开始页。"}</p><div className={styles.modalActions}><button className={styles.secondary} type="button" onClick={() => setModal(null)}>{modal === "submit" ? "继续检查" : "暂时不测"}</button><button className={styles.primary} type="button" onClick={modal === "submit" ? showResult : restartTest}>{modal === "submit" ? "提交并查看结果" : "重新开始测试"}</button></div></div></div> : null}
    </div>
  );
}
