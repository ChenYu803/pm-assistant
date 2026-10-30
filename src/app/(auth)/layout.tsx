import Link from "next/link";
import styles from "./auth.module.css";

export default function AuthLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className={styles.page}>
      <div className={styles.topline}>
        <span>AI PRODUCT FIELD / ACCOUNT</span>
        <span>AI 产品经理入职体验 · 产品实践</span>
      </div>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="AI 产品现场首页">
          <span className={styles.brandMark} aria-hidden="true">A</span>
          <span>AI 产品现场</span>
        </Link>
        <Link className={styles.returnLink} href="/">返回首页</Link>
      </header>
      <div className={styles.layout}>
        <aside className={styles.story}>
          <p className={styles.eyebrow}>AI PRODUCT FIELD</p>
          <p className={styles.storyTitle}>把对 AI 的好奇，<br /><em>孵化成产品判断。</em></p>
          <p className={styles.storyNote}>AI 产品经理入职体验<br />需求分析 · 原型 · PRD · 任务拆分</p>
          <span className={styles.storyIndex}>01 — 04 <i aria-hidden="true" /></span>
        </aside>
        <div className={styles.formPanel}>{children}</div>
      </div>
      <footer className={styles.footer}><span>AI 产品现场</span><span>把想法带到产品现场</span></footer>
    </div>
  );
}
