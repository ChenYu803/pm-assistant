"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import styles from "./ProfilePage.module.css";

type Feedback = { kind: "success" | "error"; message: string } | null;

export default function ProfilePage({ email, initialNickname }: { email: string; initialNickname: string }) {
  const [nickname, setNickname] = useState(initialNickname);
  const [savedNickname, setSavedNickname] = useState(initialNickname);
  const [nameFeedback, setNameFeedback] = useState<Feedback>(null);
  const [passwordFeedback, setPasswordFeedback] = useState<Feedback>(null);
  const [nameSaving, setNameSaving] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  async function saveNickname(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNameFeedback(null);
    const value = nickname.trim();
    if (!value || Array.from(value).length > 40) {
      setNameFeedback({ kind: "error", message: "昵称应为 1 至 40 个字符" });
      return;
    }
    setNameSaving(true);
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname: value }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "保存失败，请稍后重试");
      setNickname(result.nickname);
      setSavedNickname(result.nickname);
      setNameFeedback({ kind: "success", message: "昵称已保存" });
    } catch (error) {
      setNameFeedback({ kind: "error", message: error instanceof Error ? error.message : "保存失败，请稍后重试" });
    } finally {
      setNameSaving(false);
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordFeedback(null);
    if (newPassword.length < 6) {
      setPasswordFeedback({ kind: "error", message: "密码长度至少为 6 位" });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordFeedback({ kind: "error", message: "两次输入的新密码不一致" });
      return;
    }
    setPasswordSaving(true);
    try {
      const response = await fetch("/api/profile/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "修改失败，请稍后重试");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordFeedback({ kind: "success", message: "密码已修改" });
    } catch (error) {
      setPasswordFeedback({ kind: "error", message: error instanceof Error ? error.message : "修改失败，请稍后重试" });
    } finally {
      setPasswordSaving(false);
    }
  }

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link className={styles.brand} href="/"><span className={styles.brandMark}>A</span>AI 产品现场</Link>
          <Link className={styles.backLink} href="/">返回首页 <span aria-hidden="true">↗</span></Link>
        </div>
      </header>
      <div className={styles.content}>
        <div className={styles.heading}>
          <span className={styles.kicker}>ACCOUNT / 个人设置</span>
          <h1>个人主页</h1>
        </div>

        <section className={styles.section} aria-labelledby="nickname-title">
          <div className={styles.sectionLabel}><span>01</span><h2 id="nickname-title">用户昵称</h2></div>
          <form className={styles.sectionBody} onSubmit={saveNickname}>
            <label className={styles.fieldLabel} htmlFor="nickname">昵称</label>
            <div className={styles.inlineField}>
              <input id="nickname" name="nickname" type="text" maxLength={40} autoComplete="nickname" value={nickname} onChange={(event) => { setNickname(event.target.value); setNameFeedback(null); }} placeholder="未设置昵称" />
              <button type="submit" disabled={nameSaving || nickname.trim() === savedNickname}>{nameSaving ? "保存中..." : "保存昵称"}</button>
            </div>
            {nameFeedback && <p className={nameFeedback.kind === "error" ? styles.error : styles.success} role="status">{nameFeedback.message}</p>}
          </form>
        </section>

        <section className={styles.section} aria-labelledby="email-title">
          <div className={styles.sectionLabel}><span>02</span><h2 id="email-title">邮箱</h2></div>
          <div className={styles.sectionBody}><p className={styles.email}>{email}</p><p className={styles.hint}>邮箱暂不支持修改</p></div>
        </section>

        <section className={styles.section} aria-labelledby="password-title">
          <div className={styles.sectionLabel}><span>03</span><h2 id="password-title">修改密码</h2></div>
          <form className={styles.sectionBody} onSubmit={changePassword}>
            <div className={styles.passwordFields}>
              <label className={styles.fieldLabel} htmlFor="current-password">当前密码</label>
              <input id="current-password" type="password" autoComplete="current-password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
              <label className={styles.fieldLabel} htmlFor="new-password">新密码</label>
              <input id="new-password" type="password" autoComplete="new-password" minLength={6} required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
              <label className={styles.fieldLabel} htmlFor="confirm-password">确认新密码</label>
              <input id="confirm-password" type="password" autoComplete="new-password" required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
            </div>
            <div className={styles.formActions}><span className={styles.hint}>密码长度至少为 6 位</span><button type="submit" disabled={passwordSaving}>{passwordSaving ? "修改中..." : "修改密码"}</button></div>
            {passwordFeedback && <p className={passwordFeedback.kind === "error" ? styles.error : styles.success} role="status">{passwordFeedback.message}</p>}
          </form>
        </section>

        <div className={styles.exitRow}>
          <button type="button" disabled={leaving} onClick={async () => { setLeaving(true); await signOut({ callbackUrl: "/" }); }}>{leaving ? "退出中..." : "退出登录"} <span aria-hidden="true">↗</span></button>
        </div>
      </div>
    </div>
  );
}
